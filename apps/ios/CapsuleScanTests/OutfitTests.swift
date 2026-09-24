import XCTest
import Foundation
#if canImport(CapsuleScan)
@testable import CapsuleScan
#else
@testable import CapsuleScanCore
#endif

func outfitFixture() -> RemoteOutfit {
    .init(id: UUID().uuidString, name: "weekend", itemIds: [], createdAt: 1, updatedAt: 2, revision: 12)
}
final class OutfitTests: XCTestCase {
    func testModelPhotoEndpointKeepsAccountAuthAndEncodesRemovalAsNull() async throws {
        let credentials = MemoryCredentials()
        try await credentials.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        let response = Data(#"{"imageData":null,"revision":15}"#.utf8)
        let http = WardrobeHTTP([.init(data: response, status: 200), .init(data: response, status: 200)])
        let client = CapsuleOutfitClient(credentials: credentials, transport: http, expectedUserID: "owner")
        let photo = try await client.modelPhoto(); XCTAssertNil(try photo.decodedImage())
        _ = try await client.saveModelPhoto(nil, revision: 14)
        let requests = await http.requests
        XCTAssertEqual(requests[0].url?.path, "/api/v1/outfits/model-photo")
        XCTAssertEqual(requests[1].httpMethod, "PUT")
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer test-only" })
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(requests[1].httpBody)) as? [String: Any])
        XCTAssertTrue(body["imageData"] is NSNull); XCTAssertEqual(body["expectedRevision"] as? Int, 14)
        XCTAssertEqual(Set(body.keys), ["imageData", "expectedRevision"])
        XCTAssertThrowsError(try SyncedModelPhoto(imageData: "https://example.test/photo.jpg", revision: 3).decodedImage())
    }

    func testRenderAndRecoveryUseAuthenticatedEndpointsAndStableKey() async throws {
        let vault = MemoryCredentials(); try await vault.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        let outfit = outfitFixture()
        let receipt = OutfitRenderReceipt(state: "saved", id: outfit.id, revision: 12)
        let http = WardrobeHTTP([.init(data: try JSONEncoder().encode(receipt), status: 200), .init(data: try JSONEncoder().encode(receipt), status: 200), .init(data: Data("{\"saved\":true}".utf8), status: 200)])
        let client = CapsuleOutfitClient(credentials: vault, transport: http, expectedUserID: "owner")
        let mutation = WardrobeMutation(body: Data("{\"name\":\"weekend\"}".utf8))
        let saved = try await client.render(mutation: mutation); XCTAssertEqual(saved.id, outfit.id)
        let checked = try await client.renderStatus(key: mutation.key); XCTAssertEqual(checked, saved)
        try await client.saveKey("test-fixture")
        let requests = await http.requests
        XCTAssertEqual(requests[0].url?.path, "/api/v1/outfits/render")
        XCTAssertEqual(requests[0].httpBody, mutation.body)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Idempotency-Key"), mutation.key)
        XCTAssertEqual(requests[1].httpMethod, "GET")
        XCTAssertTrue(requests[1].url!.path.hasSuffix(mutation.key))
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer test-only" })
        XCTAssertEqual(requests[2].httpMethod, "PUT"); XCTAssertFalse(requests[2].url!.absoluteString.contains("test-fixture"))
    }
    func testPaginationAndMalformedReceiptsAreRejected() async throws {
        let vault = MemoryCredentials(); try await vault.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        let http = WardrobeHTTP([.init(data: Data(#"{"outfits":[],"cursor":0,"hasMore":true}"#.utf8), status: 200), .init(data: Data(#"{"state":"saved","id":"invalid","revision":1}"#.utf8), status: 200)])
        let client = CapsuleOutfitClient(credentials: vault, transport: http, expectedUserID: "owner")
        do { _ = try await client.page(cursor: 0); XCTFail() } catch { XCTAssertEqual(error as? OutfitError, .unavailable) }
        do { _ = try await client.renderStatus(key: UUID().uuidString); XCTFail() } catch { XCTAssertEqual(error as? OutfitError, .unavailable) }
    }
    func testLateAccountResponsesAndAuthFailuresDoNotLeak() async throws {
        let vault = MemoryCredentials(); try await vault.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        let http = WardrobeHTTP([.init(data: Data(), status: 401)], switching: vault)
        let client = CapsuleOutfitClient(credentials: vault, transport: http, expectedUserID: "owner")
        do { _ = try await client.config(); XCTFail() } catch { XCTAssertEqual(error as? OutfitError, .reconnect) }
        let login = try await vault.capsuleLogin(); XCTAssertEqual(login?.user.id, "other")
        XCTAssertEqual(CapsuleOutfitClient.mapError(.init(data: Data("private provider trace".utf8), status: 502)), .unavailable)
        let keyError = Data(#"{"error":{"code":"RENDER_KEY","message":"key missing"}}"#.utf8)
        XCTAssertEqual(CapsuleOutfitClient.mapError(.init(data: keyError, status: 422)), .keyRequired)
    }
    func testRenderPayloadBoundsAllImagesAndHasNoCredentialFields() async throws {
        let photo = try CoreTests.fixtureImage(width: 120, height: 180)
        let body = try await OutfitPayloadBuilder(images: ImageProcessor()).prepare(name: "look", photo: photo, pieces: [(wardrobeFixture(), photo)], notes: "tucked in")
        let values = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(Set(values.keys), Set(["name", "referencePhoto", "items", "notes"]))
        XCTAssertLessThan(body.count, 3_800_000)
        do { _ = try await OutfitPayloadBuilder(images: OversizedImage()).prepare(name: "look", photo: photo, pieces: [(wardrobeFixture(), photo)], notes: ""); XCTFail() }
        catch { XCTAssertEqual(error as? ScanError, .imageTooLarge) }
        let item = wardrobeFixture()
        do { _ = try await OutfitPayloadBuilder(images: ImageProcessor()).prepare(name: "look", photo: photo, pieces: [(item, photo), (item, photo)], notes: ""); XCTFail() }
        catch { XCTAssertEqual(error as? OutfitError, .invalid) }
    }
    func testModelPhotosAreAccountScopedAndRemainAfterStoreRecreation() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = ModelPhotoStore(directory: directory)
        try await first.save(Data([1,2,3]), userID: "owner/../a")
        let fresh = ModelPhotoStore(directory: directory)
        let photo = try await fresh.load(userID: "owner/../a"), other = try await fresh.load(userID: "other")
        XCTAssertEqual(photo, Data([1,2,3])); XCTAssertNil(other)
        try await fresh.save(nil, userID: "owner/../a")
        let removed = try await first.load(userID: "owner/../a"); XCTAssertNil(removed)
    }
}
