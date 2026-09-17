import Foundation

struct HTTPResult: Sendable { let data: Data; let status: Int }
protocol HTTPTransport: Sendable { func send(_ request: URLRequest) async throws -> HTTPResult }

final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // Never forward bearer credentials to another destination.
    }
}
final class HTTPClient: HTTPTransport, @unchecked Sendable {
    private let session: URLSession
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 45
        configuration.timeoutIntervalForResource = 60
        session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }
    func send(_ request: URLRequest) async throws -> HTTPResult {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, data.count <= 1_000_000 else { throw ScanError.invalidResponse }
        return HTTPResult(data: data, status: response.statusCode)
    }
}

struct DestinationReceipt: Equatable, Sendable { let itemID: String; let duplicate: Bool }
protocol WardrobeDestination: Sendable {
    func save(body: Data, idempotencyKey: String) async throws -> DestinationReceipt
}

struct CapsuleDestination: WardrobeDestination {
    static let baseURL = URL(string: "https://capsule.gtfol.dev/api/v1")!
    let credentials: any CredentialStore
    let transport: any HTTPTransport
    var expectedUserID: String? = nil

    func save(body: Data, idempotencyKey: String) async throws -> DestinationReceipt {
        let login = try await credentials.capsuleLogin()
        if let expectedUserID, login?.user.id != expectedUserID { throw ScanError.wrongAccount }
        let tokenValue: String?
        if let login { tokenValue = login.token } else { tokenValue = try await credentials.read(.capsuleToken) }
        guard let token = tokenValue, !token.isEmpty else { throw ScanError.notConnected }
        var request = URLRequest(url: Self.baseURL.appendingPathComponent("wardrobe"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = body
        let result: HTTPResult
        do { result = try await transport.send(request) }
        catch let error as ScanError { throw error }
        catch { throw ScanError.transport(error) }
        guard (200..<300).contains(result.status) else {
            let error = Self.mapError(status: result.status, data: result.data)
            if error == .authentication {
                // Do not erase a replacement token entered while this request was running.
                try? await credentials.clearCapsuleLogin(matching: token)
            }
            throw error
        }
        struct Response: Decodable { let id: String; let duplicate: Bool? }
        guard let response = try? JSONDecoder().decode(Response.self, from: result.data),
              UUID(uuidString: response.id) != nil else { throw ScanError.invalidResponse }
        return DestinationReceipt(itemID: response.id, duplicate: response.duplicate == true)
    }

    static func mapError(status: Int, data: Data) -> ScanError {
        if status == 401 || status == 403 { return .authentication }
        if status == 429 { return .rateLimited }
        if status >= 500 { return .unavailable }
        struct Envelope: Decodable { struct Detail: Decodable { let code: String }; let error: Detail }
        if status == 409, let error = try? JSONDecoder().decode(Envelope.self, from: data), error.error.code == "IDEMPOTENCY_CONFLICT" {
            return .idempotencyConflict
        }
        return .rejected
    }
}

struct CapsulePayload: Encodable {
    let fetch = false
    let name: String
    let brand: String?
    let category: String?
    let size: String?
    let color: String?
    let price: String?
    let currency: String?
    let imageData: String?

    init(fields: ItemFields, jpeg: Data?) throws {
        let fields = try fields.validated(requireName: true)
        name = fields.name
        brand = fields.brand.isEmpty ? nil : fields.brand
        category = fields.category?.rawValue
        size = fields.size.isEmpty ? nil : fields.size
        color = fields.color.isEmpty ? nil : fields.color
        price = fields.price
        currency = fields.currency.isEmpty ? nil : fields.currency
        imageData = jpeg.map { "data:image/jpeg;base64," + $0.base64EncodedString() }
    }
    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}

protocol PayloadPreparing: Sendable { func prepare(fields: ItemFields, image: Data) async throws -> Data }
struct CapsulePayloadBuilder: PayloadPreparing {
    static let maximumBodyBytes = 3_800_000
    static let maximumImageBytes = 1_500_000
    let images: any ImageProcessing
    func prepare(fields: ItemFields, image: Data) async throws -> Data {
        // Enforce both the whole-request limit and Capsule's per-photo limit.
        for edge in [1600, 1280, 1024, 800, 640, 400] {
            for quality in [0.85, 0.65, 0.45] {
                let jpeg = try await images.jpeg(image, maxEdge: edge, quality: quality).data
                guard jpeg.count <= Self.maximumImageBytes else { continue }
                let body = try CapsulePayload(fields: fields, jpeg: jpeg).encoded()
                if body.count < Self.maximumBodyBytes { return body }
            }
        }
        throw ScanError.imageTooLarge
    }
}
