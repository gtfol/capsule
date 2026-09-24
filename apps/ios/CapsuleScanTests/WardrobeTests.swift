import XCTest
import Foundation
#if canImport(CapsuleScan)
@testable import CapsuleScan
#else
@testable import CapsuleScanCore
#endif

func wardrobeFixture() -> RemoteWardrobeItem {
    RemoteWardrobeItem(id: UUID().uuidString, revision: 12, name: "shirt", brand: "", category: .tops, size: "M", color: "black", price: "19.90", currency: "USD", description: "cotton", url: "", imageUrl: "", backImageUrl: "", sideImageUrl: "", photos: .init(front: true, back: false, side: true), createdAt: 1, updatedAt: 2)
}
actor WardrobeHTTP: HTTPTransport {
    var results: [HTTPResult]
    var requests: [URLRequest] = []
    var switching: MemoryCredentials?
    init(_ results: [HTTPResult], switching: MemoryCredentials? = nil) { self.results = results; self.switching = switching }
    func send(_ request: URLRequest) async throws -> HTTPResult {
        requests.append(request)
        if let switching { try await switching.storeCapsuleLogin(CapsuleLogin(token: "replacement", user: CapsuleUser(id: "other", name: "other"))) }
        return results.removeFirst()
    }
}
final class WardrobeTests: XCTestCase {
    func testEditEncodesRevisionAndOnlyChangedPhotos() throws {
        let item = wardrobeFixture(); var edit = WardrobeEdit(item: item)
        edit.fields.price = "0.10"; edit.photos[.side] = ""
        let body = try edit.encoded(revision: item.revision)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(value["expectedRevision"] as? Int, 12)
        XCTAssertEqual(value["price"] as? String, "0.1")
        XCTAssertEqual(value["sideImageData"] as? String, "")
        XCTAssertNil(value["imageData"]); XCTAssertNil(value["backImageData"]); XCTAssertNil(value["fetch"])
        edit.url = "https://user:secret@example.test/item"; XCTAssertThrowsError(try edit.encoded(revision: 12))
        edit.url = "javascript:alert(1)"; XCTAssertThrowsError(try edit.encoded(revision: 12))
        edit.url = ""; edit.photos[.front] = String(repeating: "a", count: 2_800_001)
        XCTAssertThrowsError(try edit.encoded(revision: 12))
    }
    func testPaginatedLookupAndPrivatePhotoUseBearer() async throws {
        var item = wardrobeFixture(); item.sideImageUrl = "https://store.test/original.jpg"
        let json = try JSONSerialization.data(withJSONObject: ["items": [], "cursor": 123, "hasMore": true])
        let credentials = MemoryCredentials()
        try await credentials.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        let http = WardrobeHTTP([.init(data: json, status: 200), .init(data: Data([1, 2]), status: 200)])
        let client = CapsuleWardrobeClient(credentials: credentials, transport: http, expectedUserID: "owner")
        let page = try await client.page(cursor: 12)
        XCTAssertTrue(page.hasMore); XCTAssertEqual(page.cursor, 123)
        let data = try await client.photo(item: item, view: .side); XCTAssertEqual(data, Data([1, 2]))
        let requests = await http.requests
        XCTAssertEqual(requests[0].url?.query, "collection=wardrobe&cursor=12")
        XCTAssertTrue(requests[1].url!.path.hasSuffix("/photos/side"))
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer test-only" })
    }
    func testPublicPhotosNeverReceiveCredentials() async throws {
        var item = wardrobeFixture(); item.imageUrl = "https://store.test/shirt.jpg"
        let http = WardrobeHTTP([.init(data: Data(), status: 404), .init(data: Data([1]), status: 200)])
        let credentials = MemoryCredentials()
        try await credentials.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        _ = try await CapsuleWardrobeClient(credentials: credentials, transport: http, expectedUserID: "owner").photo(item: item, view: .front)
        let requests = await http.requests
        XCTAssertEqual(requests.count, 2)
        XCTAssertNil(requests[1].value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(requests[1].url?.host, "capsule.gtfol.dev")
        XCTAssertEqual(requests[1].url?.path, "/api/image")
    }
    func testErrorMappingAndStableMutationHeaders() async throws {
        let credentials = MemoryCredentials()
        try await credentials.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        let http = WardrobeHTTP([.init(data: Data(), status: 503), .init(data: Data(#"{"id":"piece","sync":{"status":"saved_to_cloud","revision":13}}"#.utf8), status: 200), .init(data: Data(), status: 409)])
        let client = CapsuleWardrobeClient(credentials: credentials, transport: http, expectedUserID: "owner")
        let mutation = WardrobeMutation(body: Data("{}".utf8))
        do { try await client.update(id: "piece", mutation: mutation); XCTFail() } catch { XCTAssertEqual(error as? WardrobeError, .unavailable) }
        try await client.update(id: "piece", mutation: mutation)
        do { try await client.remove(id: "piece", mutation: mutation); XCTFail() } catch { XCTAssertEqual(error as? WardrobeError, .conflict) }
        let requests = await http.requests
        XCTAssertEqual(requests[0].httpBody, requests[1].httpBody)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Idempotency-Key"), requests[1].value(forHTTPHeaderField: "Idempotency-Key"))
        XCTAssertEqual(requests[2].httpMethod, "DELETE")
    }
    func testMalformedSuccessIsNotTreatedAsAConfirmedWrite() async throws {
        let credentials = MemoryCredentials()
        try await credentials.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        let http = WardrobeHTTP([.init(data: Data("{}".utf8), status: 200)])
        let client = CapsuleWardrobeClient(credentials: credentials, transport: http, expectedUserID: "owner")
        do { try await client.update(id: "piece", mutation: .init(body: Data("{}".utf8))); XCTFail() }
        catch { XCTAssertEqual(error as? WardrobeError, .unavailable) }
    }
    func testAccountChangeRejectsLateResponseWithoutClearingReplacement() async throws {
        let credentials = MemoryCredentials()
        try await credentials.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        let http = WardrobeHTTP([.init(data: Data(), status: 401)], switching: credentials)
        let client = CapsuleWardrobeClient(credentials: credentials, transport: http, expectedUserID: "owner")
        do { _ = try await client.page(cursor: 0); XCTFail() } catch { XCTAssertEqual(error as? WardrobeError, .reconnect) }
        let login = try await credentials.capsuleLogin(); XCTAssertEqual(login?.user.id, "other")
    }
    func testUnauthorizedClearsOnlyCurrentLoginAndForbiddenRequestsReconnection() async throws {
        for status in [401, 403, 404, 429] {
            let credentials = MemoryCredentials()
            try await credentials.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
            let http = WardrobeHTTP([.init(data: Data("secret response must not be displayed".utf8), status: status)])
            let client = CapsuleWardrobeClient(credentials: credentials, transport: http, expectedUserID: "owner")
            do { _ = try await client.page(cursor: 0); XCTFail() }
            catch { XCTAssertEqual(error as? WardrobeError, status == 404 ? .missing : status == 429 ? .rateLimited : .reconnect) }
            let login = try await credentials.capsuleLogin()
            XCTAssertEqual(login == nil, status == 401)
        }
    }
}
