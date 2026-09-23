import Foundation

// Server records are kept in memory. SwiftData remains limited to unfinished scans.
struct RemoteWardrobeItem: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let revision: Int64
    var name: String
    var brand: String
    var category: GarmentCategory
    var size: String
    var color: String
    var price: String
    var currency: String
    var description: String
    var url: String
    var imageUrl: String
    var backImageUrl: String
    var sideImageUrl: String
    var photos: PhotoAvailability
    var createdAt: Double
    var updatedAt: Double
    struct PhotoAvailability: Codable, Equatable, Sendable { var front: Bool; var back: Bool; var side: Bool }
    var fields: ItemFields { ItemFields(name: name, brand: brand, category: category, color: color, size: size, price: price.isEmpty ? nil : price, currency: currency) }
    func hasPhoto(_ view: GarmentView) -> Bool {
        switch view { case .front: photos.front; case .back: photos.back; case .side: photos.side }
    }
    func photoURL(_ view: GarmentView) -> String {
        switch view { case .front: imageUrl; case .back: backImageUrl; case .side: sideImageUrl }
    }
    var primaryView: GarmentView { GarmentView.allCases.first(where: hasPhoto) ?? .front }
}
enum GarmentView: String, CaseIterable, Identifiable, Sendable {
    case front, back, side
    var id: String { rawValue }
    var dataField: String { switch self { case .front: "imageData"; case .back: "backImageData"; case .side: "sideImageData" } }
}
struct WardrobePage: Decodable, Sendable { let items: [RemoteWardrobeItem]; let cursor: Int64; let hasMore: Bool }
struct WardrobeMutation: Equatable, Sendable {
    let body: Data
    var key: String = UUID().uuidString
}
enum WardrobeError: Error, LocalizedError, Equatable {
    case reconnect, offline, unavailable, conflict, missing, invalid, rateLimited
    var errorDescription: String? {
        switch self {
        case .reconnect: "sign in again to open your wardrobe."
        case .offline: "connect to the internet and try again."
        case .unavailable: "couldn’t reach capsule. try again."
        case .conflict: "this piece changed elsewhere. reload it before saving."
        case .missing: "this piece was removed from your wardrobe."
        case .invalid: "check the item details and try again."
        case .rateLimited: "too many requests. wait a moment and try again."
        }
    }
}
protocol WardrobeServing: Sendable {
    func page(cursor: Int64) async throws -> WardrobePage
    func item(id: String) async throws -> RemoteWardrobeItem
    func photo(item: RemoteWardrobeItem, view: GarmentView) async throws -> Data
    func update(id: String, mutation: WardrobeMutation) async throws
    func remove(id: String, mutation: WardrobeMutation) async throws
}
struct CapsuleWardrobeClient: WardrobeServing {
    let credentials: any CredentialStore
    let transport: any HTTPTransport
    let expectedUserID: String
    private func request(_ path: String, query: [URLQueryItem] = [], method: String = "GET", mutation: WardrobeMutation? = nil) async throws -> HTTPResult {
        guard let login = try await credentials.capsuleLogin(), login.user.id == expectedUserID else { throw WardrobeError.reconnect }
        var components = URLComponents(url: CapsuleDestination.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("Bearer \(login.token)", forHTTPHeaderField: "Authorization")
        if let mutation {
            request.httpBody = mutation.body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(mutation.key, forHTTPHeaderField: "Idempotency-Key")
        }
        let result: HTTPResult
        do { result = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
        catch { throw ScanError.transport(error) == .offline ? WardrobeError.offline : WardrobeError.unavailable }
        // Never apply a response belonging to an account that was replaced during the request.
        guard try await credentials.capsuleLogin() == login else { throw WardrobeError.reconnect }
        if result.status == 401 {
            try? await credentials.clearCapsuleLogin(matching: login.token)
            throw WardrobeError.reconnect
        }
        if result.status == 403 { throw WardrobeError.reconnect }
        if result.status == 404 { throw WardrobeError.missing }
        if result.status == 429 { throw WardrobeError.rateLimited }
        if result.status >= 500 { throw WardrobeError.unavailable }
        if result.status == 409 {
            struct Envelope: Decodable { struct Detail: Decodable { let code: String }; let error: Detail }
            if (try? JSONDecoder().decode(Envelope.self, from: result.data).error.code) == "IDEMPOTENCY_CONFLICT" { throw ScanError.idempotencyConflict }
            throw WardrobeError.conflict
        }
        guard (200..<300).contains(result.status) else { throw WardrobeError.invalid }
        return result
    }
    func page(cursor: Int64) async throws -> WardrobePage {
        let response = try await request("items", query: [.init(name: "collection", value: "wardrobe"), .init(name: "cursor", value: String(cursor))])
        guard let page = try? JSONDecoder().decode(WardrobePage.self, from: response.data), !page.hasMore || page.cursor > cursor else { throw WardrobeError.unavailable }
        return page
    }
    func item(id: String) async throws -> RemoteWardrobeItem {
        struct Envelope: Decodable { let item: RemoteWardrobeItem }
        let response = try await request("wardrobe/\(id)")
        guard let result = try? JSONDecoder().decode(Envelope.self, from: response.data), result.item.id == id else { throw WardrobeError.unavailable }
        return result.item
    }
    func photo(item: RemoteWardrobeItem, view: GarmentView) async throws -> Data {
        // A cached/cutout photo takes precedence over its original product URL.
        do { return try await request("wardrobe/\(item.id)/photos/\(view.rawValue)").data }
        catch WardrobeError.missing {
            let url = item.photoURL(view)
            guard !url.isEmpty else { throw WardrobeError.missing }
            // Public product images go through Capsule's SSRF-protected proxy. No account token is sent.
            var components = URLComponents(string: "https://capsule.gtfol.dev/api/image")!
            components.queryItems = [.init(name: "url", value: url)]
            let result = try await transport.send(URLRequest(url: components.url!))
            guard (200..<300).contains(result.status) else { throw WardrobeError.unavailable }
            return result.data
        }
    }

    private func write(id: String, method: String, mutation: WardrobeMutation) async throws {
        struct Receipt: Decodable {
            struct Sync: Decodable { let status: String; let revision: Int64 }
            let id: String; let sync: Sync
        }
        let result = try await request("wardrobe/\(id)", method: method, mutation: mutation)
        guard let receipt = try? JSONDecoder().decode(Receipt.self, from: result.data), receipt.id == id,
              receipt.sync.status == "saved_to_cloud", receipt.sync.revision > 0 else { throw WardrobeError.unavailable }
    }
    func update(id: String, mutation: WardrobeMutation) async throws { try await write(id: id, method: "PATCH", mutation: mutation) }
    func remove(id: String, mutation: WardrobeMutation) async throws { try await write(id: id, method: "DELETE", mutation: mutation) }
}

struct WardrobeEdit: Equatable, Sendable {
    var fields: ItemFields
    var description: String
    var url: String
    // Only changed views are included; an empty string explicitly removes a view.
    var photos: [GarmentView: String] = [:]
    init(item: RemoteWardrobeItem) { fields = item.fields; description = item.description; url = item.url }
    func encoded(revision: Int64) throws -> Data {
        let fields = try fields.validated(requireName: true)
        let link = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if !link.isEmpty {
            guard let url = URL(string: link), ["https", "http"].contains(url.scheme?.lowercased()), url.host != nil, url.user == nil, url.password == nil else { throw WardrobeError.invalid }
        }
        guard description.count <= 20_000, link.count <= 8_000 else { throw WardrobeError.invalid }
        var values: [String: Any] = ["expectedRevision": revision, "name": fields.name, "brand": fields.brand, "category": fields.category?.rawValue ?? "tops", "size": fields.size, "color": fields.color, "price": fields.price ?? "", "currency": fields.currency, "description": description, "url": link]
        for (view, photo) in photos { values[view.dataField] = photo }
        let body = try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys, .withoutEscapingSlashes])
        guard body.count < CapsulePayloadBuilder.maximumBodyBytes, photos.values.reduce(0, { $0 + $1.count }) <= 2_800_000 else { throw ScanError.imageTooLarge }
        return body
    }
}
