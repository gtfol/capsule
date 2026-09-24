import Foundation
import CryptoKit

struct RemoteOutfit: Codable, Equatable, Identifiable, Sendable {
    let id: String
    var name: String
    let itemIds: [String]
    let createdAt: Double
    let updatedAt: Double
    let revision: Int64
}
struct OutfitPage: Decodable, Sendable { let outfits: [RemoteOutfit]; let cursor: Int64; let hasMore: Bool }
struct SyncedModelPhoto: Codable, Sendable {
    let imageData: String?
    let revision: Int64
    func decodedImage() throws -> Data? {
        guard revision >= 0 else { throw OutfitError.unavailable }
        guard let imageData else { return nil }
        let prefix = "data:image/jpeg;base64,"
        guard imageData.hasPrefix(prefix), imageData.utf8.count <= 2_100_000,
              let data = Data(base64Encoded: String(imageData.dropFirst(prefix.count))), !data.isEmpty else { throw OutfitError.unavailable }
        return data
    }
}
struct OutfitConfig: Decodable, Sendable {
    let enabled: Bool
    let model: String
    let keyStorageAvailable: Bool
    let hasSavedKey: Bool
}
struct OutfitRenderReceipt: Codable, Equatable, Sendable {
    let state: String
    let id: String?
    let revision: Int64?
}
enum OutfitError: Error, LocalizedError, Equatable {
    case reconnect, offline, unavailable, conflict, missing, invalid, rateLimited, keyRequired
    case renderFailed(String), interrupted
    var errorDescription: String? {
        switch self {
        case .reconnect: "sign in again to connect your outfits."
        case .offline: "connect to the internet and try again."
        case .unavailable: "couldn’t reach capsule. try again."
        case .conflict: "this outfit changed elsewhere. reload it before saving."
        case .missing: "this outfit was removed."
        case .invalid: "check your photo and selected pieces."
        case .rateLimited: "wait a few minutes before trying again."
        case .keyRequired: "add an OpenAI key in settings to render outfits."
        case .renderFailed(let message): message
        case .interrupted: "this render was interrupted. check your outfits before rendering again; OpenAI may have charged for it."
        }
    }
}
protocol OutfitServing: Sendable {
    func page(cursor: Int64) async throws -> OutfitPage
    func item(id: String) async throws -> RemoteOutfit
    func photo(item: RemoteOutfit) async throws -> Data
    func update(id: String, mutation: WardrobeMutation) async throws
    func remove(id: String, mutation: WardrobeMutation) async throws
    func modelPhoto() async throws -> SyncedModelPhoto
    func saveModelPhoto(_ photo: Data?, revision: Int64) async throws -> SyncedModelPhoto
    func config() async throws -> OutfitConfig
    func saveKey(_ value: String?) async throws
    func render(mutation: WardrobeMutation) async throws -> OutfitRenderReceipt
    func renderStatus(key: String) async throws -> OutfitRenderReceipt
}
struct CapsuleOutfitClient: OutfitServing {
    let credentials: any CredentialStore
    let transport: any HTTPTransport
    let expectedUserID: String
    private func request(_ path: String, method: String = "GET", body: Data? = nil, key: String? = nil) async throws -> HTTPResult {
        guard let login = try await credentials.capsuleLogin(), login.user.id == expectedUserID else { throw OutfitError.reconnect }
        guard let url = URL(string: "outfits" + path, relativeTo: URL(string: "https://capsule.gtfol.dev/api/v1/")) else { throw OutfitError.invalid }
        var request = URLRequest(url: url.absoluteURL, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method; request.httpBody = body
        request.timeoutInterval = path == "/render" ? 130 : 45
        request.setValue("Bearer \(login.token)", forHTTPHeaderField: "Authorization")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let key { request.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
        let response: HTTPResult
        do { response = try await transport.send(request) }
        catch is CancellationError { throw CancellationError() }
        catch { throw ScanError.transport(error) == .offline ? OutfitError.offline : OutfitError.unavailable }
        guard try await credentials.capsuleLogin() == login else { throw OutfitError.reconnect }
        if response.status == 401 { try? await credentials.clearCapsuleLogin(matching: login.token); throw OutfitError.reconnect }
        if response.status == 403 { throw OutfitError.reconnect }
        guard (200..<300).contains(response.status) else { throw Self.mapError(response) }
        return response
    }
    static func mapError(_ response: HTTPResult) -> OutfitError {
        struct Envelope: Decodable { struct Detail: Decodable { let code: String; let message: String }; let error: Detail }
        let error = try? JSONDecoder().decode(Envelope.self, from: response.data).error
        if error?.code == "RENDER_INTERRUPTED" { return .interrupted }
        if error?.code == "RENDER_KEY" { return .keyRequired }
        if error?.code == "RENDER_FAILED", let message = error?.message, !message.isEmpty, message.count <= 500 { return .renderFailed(message.lowercased()) }
        switch response.status {
        case 401, 403: return .reconnect
        case 404: return .missing
        case 409: return .conflict
        case 429: return .rateLimited
        case 500...599: return .unavailable
        default: return .invalid
        }
    }
    private func decode<T: Decodable>(_ type: T.Type, response: HTTPResult) throws -> T {
        guard let value = try? JSONDecoder().decode(type, from: response.data) else { throw OutfitError.unavailable }
        return value
    }
    func page(cursor: Int64) async throws -> OutfitPage {
        let page = try decode(OutfitPage.self, response: await request("?cursor=\(cursor)"))
        guard !page.hasMore || page.cursor > cursor else { throw OutfitError.unavailable }
        return page
    }
    func item(id: String) async throws -> RemoteOutfit {
        guard UUID(uuidString: id) != nil else { throw OutfitError.invalid }
        struct Envelope: Decodable { let outfit: RemoteOutfit }
        let outfit = try decode(Envelope.self, response: await request("/\(id)")).outfit
        guard outfit.id == id else { throw OutfitError.unavailable }
        return outfit
    }
    func photo(item: RemoteOutfit) async throws -> Data {
        guard UUID(uuidString: item.id) != nil else { throw OutfitError.invalid }
        return try await request("/\(item.id)/image").data
    }
    private func mutate(id: String, method: String, mutation: WardrobeMutation) async throws {
        guard UUID(uuidString: id) != nil else { throw OutfitError.invalid }
        struct Receipt: Decodable { let id: String; let revision: Int64 }
        let result = try decode(Receipt.self, response: await request("/\(id)", method: method, body: mutation.body, key: mutation.key))
        guard result.id == id, result.revision > 0 else { throw OutfitError.unavailable }
    }
    func update(id: String, mutation: WardrobeMutation) async throws { try await mutate(id: id, method: "PATCH", mutation: mutation) }
    func remove(id: String, mutation: WardrobeMutation) async throws { try await mutate(id: id, method: "DELETE", mutation: mutation) }
    func modelPhoto() async throws -> SyncedModelPhoto {
        let value = try decode(SyncedModelPhoto.self, response: await request("/model-photo"))
        _ = try value.decodedImage()
        return value
    }
    func saveModelPhoto(_ photo: Data?, revision: Int64) async throws -> SyncedModelPhoto {
        struct Body: Encodable { let imageData: String?; let expectedRevision: Int64
            enum CodingKeys: String, CodingKey { case imageData, expectedRevision }
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(imageData, forKey: .imageData)
                try container.encode(expectedRevision, forKey: .expectedRevision)
            }
        }
        guard revision >= 0, (photo?.count ?? 0) <= 1_500_000 else { throw OutfitError.invalid }
        let body = Body(imageData: photo.map { "data:image/jpeg;base64," + $0.base64EncodedString() }, expectedRevision: revision)
        let value = try decode(SyncedModelPhoto.self, response: await request("/model-photo", method: "PUT", body: JSONEncoder().encode(body)))
        _ = try value.decodedImage()
        return value
    }
    func config() async throws -> OutfitConfig { try decode(OutfitConfig.self, response: await request("/config")) }
    func saveKey(_ value: String?) async throws {
        let values = value.map { ["apiKey": $0] } ?? [:]
        _ = try await request("/key", method: value == nil ? "DELETE" : "PUT", body: JSONEncoder().encode(values))
    }
    private func receipt(_ response: HTTPResult) throws -> OutfitRenderReceipt {
        let value = try decode(OutfitRenderReceipt.self, response: response)
        guard value.state == "pending" || (value.state == "saved" && UUID(uuidString: value.id ?? "") != nil && (value.revision ?? 0) > 0) else { throw OutfitError.unavailable }
        return value
    }
    func render(mutation: WardrobeMutation) async throws -> OutfitRenderReceipt {
        try receipt(await request("/render", method: "POST", body: mutation.body, key: mutation.key))
    }
    func renderStatus(key: String) async throws -> OutfitRenderReceipt {
        guard UUID(uuidString: key) != nil else { throw OutfitError.invalid }
        return try receipt(await request("/render/\(key)"))
    }
}

struct OutfitPayloadBuilder: Sendable {
    let images: any ImageProcessing
    func prepare(name: String, photo: Data, pieces: [(RemoteWardrobeItem, Data)], notes: String) async throws -> Data {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 500, !pieces.isEmpty, pieces.count <= 6,
              Set(pieces.map { $0.0.id }).count == pieces.count, notes.count <= 300 else { throw OutfitError.invalid }
        for edge in [1200, 900, 700, 500] {
            let model = try await images.jpeg(photo, maxEdge: edge, quality: 0.8).data
            var selected: [[String: String]] = []
            var largest = model.count
            for (piece, original) in pieces {
                let data = try await images.jpeg(original, maxEdge: min(edge, 900), quality: 0.78).data
                largest = max(largest, data.count)
                selected.append(["id": piece.id, "name": piece.name, "category": piece.category.rawValue, "imageData": "data:image/jpeg;base64," + data.base64EncodedString()])
            }
            let body = try JSONSerialization.data(withJSONObject: ["name": name, "notes": notes, "referencePhoto": "data:image/jpeg;base64," + model.base64EncodedString(), "items": selected], options: [.sortedKeys, .withoutEscapingSlashes])
            if largest <= 1_500_000, body.count < 3_800_000 { return body }
        }
        throw ScanError.imageTooLarge
    }
}

protocol ModelPhotoStoring: Sendable {
    func load(userID: String) async throws -> Data?
    func save(_ photo: Data?, userID: String) async throws
}
actor ModelPhotoStore: ModelPhotoStoring {
    let directory: URL
    init(directory: URL) { self.directory = directory }
    private func file(_ userID: String) -> URL {
        let name = SHA256.hash(data: Data(userID.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name + ".jpg")
    }
    func load(userID: String) throws -> Data? {
        guard FileManager.default.fileExists(atPath: file(userID).path) else { return nil }
        return try Data(contentsOf: file(userID))
    }
    func save(_ photo: Data?, userID: String) throws {
        let destination = file(userID)
        if let photo {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            #if os(iOS)
            try photo.write(to: destination, options: [.atomic, .completeFileProtection])
            #else
            try photo.write(to: destination, options: .atomic)
            #endif
        } else if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
    }
}
