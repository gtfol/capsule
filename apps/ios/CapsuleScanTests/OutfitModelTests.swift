#if canImport(CapsuleScan)
import XCTest
@testable import CapsuleScan

actor OutfitStub: OutfitServing {
    var outfit = outfitFixture()
    var modelPhotoValue = SyncedModelPhoto(imageData: nil, revision: 0)
    var modelPhotoWrites = 0
    func modelPhoto() -> SyncedModelPhoto { modelPhotoValue }
    func saveModelPhoto(_ photo: Data?, revision: Int64) throws -> SyncedModelPhoto {
        guard revision == modelPhotoValue.revision else { throw OutfitError.conflict }
        modelPhotoWrites += 1
        modelPhotoValue = .init(imageData: photo.map { "data:image/jpeg;base64," + $0.base64EncodedString() }, revision: revision + 1)
        return modelPhotoValue
    }
    func remotePhoto(_ photo: Data?, revision: Int64) { modelPhotoValue = .init(imageData: photo.map { "data:image/jpeg;base64," + $0.base64EncodedString() }, revision: revision) }
    var mutations: [WardrobeMutation] = []
    var statusKeys: [String] = []
    var failure: OutfitError? = .offline
    var statusFailure: OutfitError?
    var itemFailure: OutfitError?
    func page(cursor: Int64) -> OutfitPage { .init(outfits: [outfit], cursor: 12, hasMore: false) }
    func item(id: String) throws -> RemoteOutfit { if let itemFailure { throw itemFailure }; return outfit }
    func photo(item: RemoteOutfit) -> Data { Data([1]) }
    func config() -> OutfitConfig { .init(enabled: true, model: "test-model", keyStorageAvailable: true, hasSavedKey: true) }
    func saveKey(_ value: String?) {}
    func update(id: String, mutation: WardrobeMutation) throws {
        mutations.append(mutation); if let failure { throw failure }
        if let data = try JSONSerialization.jsonObject(with: mutation.body) as? [String: Any], let name = data["name"] as? String { outfit.name = name }
    }
    func remove(id: String, mutation: WardrobeMutation) throws { mutations.append(mutation); if let failure { throw failure } }
    func render(mutation: WardrobeMutation) throws -> OutfitRenderReceipt { mutations.append(mutation); if let failure { throw failure }; return .init(state: "saved", id: outfit.id, revision: outfit.revision) }
    func renderStatus(key: String) throws -> OutfitRenderReceipt { statusKeys.append(key); if let statusFailure { throw statusFailure }; return .init(state: "saved", id: outfit.id, revision: outfit.revision) }
    func fail(_ value: OutfitError?) { failure = value }
    func failStatus(_ value: OutfitError?) { statusFailure = value }
    func failItem(_ value: OutfitError?) { itemFailure = value }
}
actor OutfitPiecesStub: WardrobeServing {
    let value = wardrobeFixture()
    func page(cursor: Int64) -> WardrobePage { .init(items: [value], cursor: 12, hasMore: false) }
    func item(id: String) -> RemoteWardrobeItem { value }
    func photo(item: RemoteWardrobeItem, view: GarmentView) throws -> Data { try CoreTests.fixtureImage(width: 8, height: 12) }
    func update(id: String, mutation: WardrobeMutation) {}
    func remove(id: String, mutation: WardrobeMutation) {}
}
@MainActor final class OutfitModelTests: XCTestCase {
    func testModelPhotoSyncLoadsWebPhotoAndRespectsRemoteRemovalAndConflicts() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), suite = UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: directory) }
        let client = OutfitStub(), photos = ModelPhotoStore(directory: directory)
        let old = try CoreTests.fixtureImage(width: 10, height: 20), web = try CoreTests.fixtureImage(width: 30, height: 40)
        try await photos.save(old, userID: "owner")
        await client.remotePhoto(web, revision: 10)
        let model = OutfitBuilderModel(client: client, wardrobe: OutfitPiecesStub(), userID: "owner", photos: photos, images: ImageProcessor(), defaults: defaults)
        await model.load()
        XCTAssertEqual(model.photo, web)
        var writes = await client.modelPhotoWrites; XCTAssertEqual(writes, 0)
        await client.remotePhoto(nil, revision: 11)
        await model.load(); XCTAssertNil(model.photo)
        let cached = try await photos.load(userID: "owner"); XCTAssertNil(cached)
        writes = await client.modelPhotoWrites; XCTAssertEqual(writes, 0)
        await model.setPhoto(old)
        let uploaded = await client.modelPhotoValue
        XCTAssertNotNil(uploaded.imageData); XCTAssertEqual(uploaded.revision, 12)
        await client.remotePhoto(web, revision: 13)
        await model.setPhoto(nil)
        XCTAssertEqual(model.photo, web); XCTAssertNotNil(model.error)
        let remote = await client.modelPhotoValue; XCTAssertEqual(remote.revision, 13)
    }
    func testLegacyPhonePhotoMigratesOnlyToNeverSetAccount() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), suite = UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: directory) }
        let client = OutfitStub(), photos = ModelPhotoStore(directory: directory)
        let original = try CoreTests.fixtureImage(width: 10, height: 20)
        try await photos.save(original, userID: "owner")
        let model = OutfitBuilderModel(client: client, wardrobe: OutfitPiecesStub(), userID: "owner", photos: photos, images: ImageProcessor(), defaults: defaults)
        await model.load(); await model.load()
        let writes = await client.modelPhotoWrites; XCTAssertEqual(writes, 1)
        XCTAssertEqual(model.photo, original)
    }
    func testCompletedRenderKeepsReceiptWhenLoadingResultFails() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), suite = UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: directory) }
        let client = OutfitStub(), wardrobe = OutfitPiecesStub(), photos = ModelPhotoStore(directory: directory)
        try await photos.save(CoreTests.fixtureImage(width: 8, height: 12), userID: "owner")
        let model = OutfitBuilderModel(client: client, wardrobe: wardrobe, userID: "owner", photos: photos, images: ImageProcessor(), defaults: defaults)
        await model.load(); model.selected = Set(model.pieces.map(\.id))
        await client.fail(nil); await client.failItem(.rateLimited)
        await model.render()
        let key = try XCTUnwrap(model.pendingKey)
        XCTAssertNil(model.result)
        await client.failItem(nil); await model.checkRender()
        XCTAssertNotNil(model.result); XCTAssertNil(model.pendingKey)
        let writes = await client.mutations, checks = await client.statusKeys
        XCTAssertEqual(writes.count, 1); XCTAssertEqual(checks, [key])
    }
    func testTimedOutRenderRecoversAfterReopeningWithoutPostingAgain() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), suite = UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite)); defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: directory) }
        let client = OutfitStub(), wardrobe = OutfitPiecesStub(), photos = ModelPhotoStore(directory: directory)
        try await photos.save(CoreTests.fixtureImage(width: 8, height: 12), userID: "owner")
        let first = OutfitBuilderModel(client: client, wardrobe: wardrobe, userID: "owner", photos: photos, images: ImageProcessor(), defaults: defaults)
        await first.load(); first.selected = Set(first.pieces.map(\.id)); await first.render()
        let key = try XCTUnwrap(first.pendingKey); XCTAssertFalse(first.canRender)
        let reopened = OutfitBuilderModel(client: client, wardrobe: wardrobe, userID: "owner", photos: photos, images: ImageProcessor(), defaults: defaults)
        XCTAssertEqual(reopened.pendingKey, key)
        await client.failStatus(.rateLimited); await reopened.checkRender()
        XCTAssertEqual(reopened.pendingKey, key, "status rate limits must not lose the paid render identity")
        await client.failStatus(nil); await reopened.checkRender()
        XCTAssertNotNil(reopened.result); XCTAssertNil(reopened.pendingKey)
        let mutations = await client.mutations, keys = await client.statusKeys
        XCTAssertEqual(mutations.count, 1); XCTAssertEqual(keys, [key, key])
        let other = OutfitBuilderModel(client: client, wardrobe: wardrobe, userID: "other", photos: photos, images: ImageProcessor(), defaults: defaults)
        XCTAssertNil(other.pendingKey)
    }
    func testRenameRetriesExactMutationAndChangingNameCreatesNewKey() async {
        let client = OutfitStub(), model = OutfitDetailModel(outfit: outfitFixture(), client: OutfitStub())
        let detail = OutfitDetailModel(outfit: model.outfit, client: client)
        detail.name = "friday"; await detail.save(); await detail.save()
        var writes = await client.mutations; XCTAssertEqual(writes[0], writes[1])
        detail.name = "saturday"; await detail.save(); writes = await client.mutations; XCTAssertNotEqual(writes[1].key, writes[2].key)
        await client.fail(.conflict); await detail.save(); XCTAssertTrue(detail.conflict)
        let count = await client.mutations.count; await detail.save(); let after = await client.mutations.count; XCTAssertEqual(count, after)
        await detail.reload(); XCTAssertFalse(detail.conflict)
    }
    func testPhotoImportBlocksRendering() async throws {
        let client = OutfitStub(), wardrobe = OutfitPiecesStub()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), suite = UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite)); defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: directory) }
        let model = OutfitBuilderModel(client: client, wardrobe: wardrobe, userID: "owner", photos: ModelPhotoStore(directory: directory), images: ImageProcessor(), defaults: defaults)
        await model.load(); model.photo = try CoreTests.fixtureImage(width: 8, height: 12); model.selected = Set(model.pieces.map(\.id))
        XCTAssertTrue(model.canRender); model.importingPhoto = true; XCTAssertFalse(model.canRender)
        await model.render(); let requests = await client.mutations; XCTAssertTrue(requests.isEmpty)
    }
}
#endif
