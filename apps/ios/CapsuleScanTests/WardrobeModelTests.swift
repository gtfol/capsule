#if canImport(CapsuleScan)
import XCTest
@testable import CapsuleScan

actor LibraryStub: WardrobeServing {
    var pages: [WardrobePage]
    var current: RemoteWardrobeItem
    var failUpdate = true
    var photoData: Data?
    var photoRequests = 0
    var updates: [WardrobeMutation] = []
    var cursors: [Int64] = []
    var pageFailure: WardrobeError?
    var delay = false
    var delayedCursor: Int64?
    init(_ item: RemoteWardrobeItem, pages: [WardrobePage] = []) { current = item; self.pages = pages }
    func page(cursor: Int64) async throws -> WardrobePage {
        cursors.append(cursor)
        if delay, delayedCursor == nil || delayedCursor == cursor { try await Task.sleep(for: .seconds(30)) }
        if let pageFailure { throw pageFailure }
        return pages.isEmpty ? .init(items: [current], cursor: 12, hasMore: false) : pages.removeFirst()
    }
    func failPages(_ error: WardrobeError?) { pageFailure = error }
    func delayPages(_ value: Bool, cursor: Int64? = nil) { delay = value; delayedCursor = cursor }
    func item(id: String) -> RemoteWardrobeItem { current }
    func photo(item: RemoteWardrobeItem, view: GarmentView) throws -> Data { photoRequests += 1; guard let photoData else { throw WardrobeError.unavailable }; return photoData }
    func setPhoto(_ data: Data) { photoData = data }
    func update(id: String, mutation: WardrobeMutation) throws { updates.append(mutation); if failUpdate { throw WardrobeError.unavailable } }
    func remove(id: String, mutation: WardrobeMutation) throws { throw WardrobeError.conflict }
    func succeed() { failUpdate = false }
}
@MainActor final class WardrobeModelTests: XCTestCase {
    func testFirstPageIsUsableWhileRemainingPagesLoadAndCancellationCanRetry() async {
        let item = wardrobeFixture(), service = LibraryStub(wardrobeFixture(), pages: [.init(items: [wardrobeFixture()], cursor: 12, hasMore: true)])
        let model = WardrobeModel(), revision = UUID()
        await service.delayPages(true, cursor: 12)
        let task = Task { await model.load(client: service, reloadID: revision) }
        while await service.cursors.count < 2 { await Task.yield() }
        XCTAssertTrue(model.loaded); XCTAssertTrue(model.loading); XCTAssertEqual(model.items.count, 1)
        XCTAssertNil(model.error)
        task.cancel(); await task.value
        XCTAssertTrue(model.loaded); XCTAssertFalse(model.loading); XCTAssertNil(model.error)
        // An interrupted multi-page load isn't marked complete for this reload ID.
        await model.load(client: LibraryStub(item), reloadID: revision)
        XCTAssertEqual(model.items, [item])
    }
    func testRefreshDoesNotReplaceCachedItemsUntilAllPagesArrive() async {
        let original = wardrobeFixture(), model = WardrobeModel()
        await model.load(client: LibraryStub(original))
        let client = LibraryStub(wardrobeFixture(), pages: [.init(items: [wardrobeFixture()], cursor: 12, hasMore: true)])
        await client.delayPages(true, cursor: 12)
        let task = Task { await model.load(client: client, refreshPhotos: true) }
        while await client.cursors.count < 2 { await Task.yield() }
        XCTAssertEqual(model.items, [original]); XCTAssertTrue(model.loading)
        task.cancel(); await task.value
        XCTAssertEqual(model.items, [original]); XCTAssertNil(model.error)
    }
    func testAppearanceReusesLoadedAndEmptyResultsUntilMutationOrExplicitRefresh() async {
        for items in [[], [wardrobeFixture()]] {
            let service = LibraryStub(wardrobeFixture(), pages: [.init(items: items, cursor: 12, hasMore: false)])
            let model = WardrobeModel(), revision = UUID()
            for _ in 0..<5 { await model.load(client: service, reloadID: revision) }
            XCTAssertTrue(model.loaded); XCTAssertEqual(model.items, items)
            var requests = await service.cursors; XCTAssertEqual(requests, [0])
            await model.load(client: service, reloadID: UUID())
            requests = await service.cursors; XCTAssertEqual(requests, [0, 0])
            await model.load(client: service, refreshPhotos: true)
            requests = await service.cursors; XCTAssertEqual(requests, [0, 0, 0])
        }
    }
    func testFailedRefreshKeepsCachedItemsAndRetriesOnlyWhenRequested() async {
        let item = wardrobeFixture(), service = LibraryStub(wardrobeFixture()), model = WardrobeModel()
        let revision = UUID()
        await model.load(client: LibraryStub(item), reloadID: revision)
        let photos = model.photoReloadID
        await service.failPages(.offline)
        await model.load(client: service, refreshPhotos: true)
        XCTAssertEqual(model.items, [item]); XCTAssertTrue(model.loaded)
        XCTAssertNotNil(model.error); XCTAssertEqual(model.photoReloadID, photos)
        await model.load(client: service, reloadID: revision)
        var requests = await service.cursors; XCTAssertEqual(requests, [0])
        await service.failPages(nil)
        await model.load(client: service, refreshPhotos: true)
        XCTAssertNil(model.error); XCTAssertNotEqual(model.photoReloadID, photos)
        requests = await service.cursors; XCTAssertEqual(requests, [0, 0])
    }
    func testCancelledInitialLoadCanResumeOnNextAppearance() async throws {
        let service = LibraryStub(wardrobeFixture()), model = WardrobeModel(), revision = UUID()
        await service.delayPages(true)
        let task = Task { await model.load(client: service, reloadID: revision) }
        while await service.cursors.isEmpty { await Task.yield() }
        task.cancel(); await task.value
        XCTAssertFalse(model.loaded); XCTAssertNil(model.error)
        await service.delayPages(false)
        await model.load(client: service, reloadID: revision)
        XCTAssertTrue(model.loaded)
        let requests = await service.cursors; XCTAssertEqual(requests, [0, 0])
    }
    func testInitialErrorDoesNotLoopOnAppearanceAndExplicitRetryCanRecover() async {
        let service = LibraryStub(wardrobeFixture()), model = WardrobeModel(), revision = UUID()
        await service.failPages(.offline)
        await model.load(client: service, reloadID: revision)
        await model.load(client: service, reloadID: revision)
        XCTAssertFalse(model.loaded); XCTAssertNotNil(model.error)
        var requests = await service.cursors; XCTAssertEqual(requests, [0])
        await service.failPages(nil)
        await model.load(client: service)
        XCTAssertTrue(model.loaded); XCTAssertNil(model.error)
        requests = await service.cursors; XCTAssertEqual(requests, [0, 0])
    }
    func testOnlySuccessfulWritesInvalidateLibrary() async {
        let service = LibraryStub(wardrobeFixture())
        var mutations = 0
        let model = WardrobeDetailModel(item: wardrobeFixture(), client: service, images: ImageProcessor(), isolation: VisionImageIsolator(), onMutation: { mutations += 1 })
        await model.reload()
        model.edit.fields.name = "changed"
        XCTAssertEqual(mutations, 0)
        _ = await model.save()
        XCTAssertEqual(mutations, 0)
        await service.succeed()
        _ = await model.save()
        XCTAssertEqual(mutations, 1)
    }
    func testEmptyIntermediatePageContinuesAndDeduplicatesLatestRevision() async {
        let item = wardrobeFixture()
        let service = LibraryStub(item, pages: [.init(items: [], cursor: 1, hasMore: true), .init(items: [item, item], cursor: 12, hasMore: false)])
        let model = WardrobeModel()
        await model.load(client: service)
        XCTAssertTrue(model.loaded); XCTAssertNil(model.error); XCTAssertEqual(model.items.count, 1)
        let cursors = await service.cursors; XCTAssertEqual(cursors, [0, 1])
    }
    func testRefreshReplacesLoadedRecordsAndReloadsPhotosEvenAtSameRevision() async throws {
        let original = wardrobeFixture(), removed = wardrobeFixture()
        var updated = original; updated.name = "edited on web"; updated.imageUrl = "https://store.test/new.png"
        let service = LibraryStub(original, pages: [
            .init(items: [original, removed], cursor: 12, hasMore: false),
            .init(items: [updated], cursor: 12, hasMore: false)
        ])
        let model = WardrobeModel()
        await model.load(client: service)
        let first = model.photoReloadID
        let cache = WardrobePhotoCache()
        let old = try await cache.load(key: first.uuidString) { Data([1]) }
        XCTAssertEqual(old, Data([1]))
        await model.load(client: service, refreshPhotos: true)
        XCTAssertEqual(model.items, [updated]); XCTAssertNotEqual(first, model.photoReloadID)
        let fresh = try await cache.load(key: model.photoReloadID.uuidString) { Data([2]) }
        XCTAssertEqual(fresh, Data([2]))
        let cursors = await service.cursors; XCTAssertEqual(cursors, [0, 0])
    }
    func testCutoutPreviewAndUploadRetainTransparency() async throws {
        let item = wardrobeFixture(), service = LibraryStub(wardrobeFixture())
        await service.setPhoto(try CoreTests.fixtureImage(width: 300, height: 400))
        let png = try IsolationTests.fixture()
        let model = WardrobeDetailModel(item: item, client: service, images: ImageProcessor(), isolation: StubIsolator(output: png))
        await model.cutout(.front)
        XCTAssertNil(model.error)
        XCTAssertTrue(try XCTUnwrap(model.edit.photos[.front]).hasPrefix("data:image/png;base64,"))
        XCTAssertTrue(PhotoEncoding.isPNG(try XCTUnwrap(model.previews[.front])))
        let body = try model.edit.encoded(revision: item.revision)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertTrue(try XCTUnwrap(json["imageData"] as? String).hasPrefix("data:image/png;base64,"))
        XCTAssertLessThan(body.count, 3_800_000)
        model.restorePhoto(.front)
        XCTAssertNil(model.edit.photos[.front])
    }
    func testFailedEditRetriesExactBodyAndKeyUntilFieldsChange() async {
        let item = wardrobeFixture(); let service = LibraryStub(item)
        let model = WardrobeDetailModel(item: item, client: service, images: ImageProcessor(), isolation: VisionImageIsolator())
        model.edit.fields.name = "updated shirt"
        let first = await model.save(); let second = await model.save()
        XCTAssertFalse(first); XCTAssertFalse(second); XCTAssertTrue(model.hasChanges)
        var requests = await service.updates
        XCTAssertEqual(requests[0], requests[1])
        model.edit.fields.size = "L"
        _ = await model.save()
        requests = await service.updates
        XCTAssertNotEqual(requests[1].key, requests[2].key); XCTAssertNotEqual(requests[1].body, requests[2].body)
        await service.succeed()
        let saved = await model.save(); XCTAssertTrue(saved)
        requests = await service.updates; XCTAssertEqual(requests[2], requests[3])
    }
    func testDeleteConflictPreservesEditsUntilExplicitReload() async {
        let item = wardrobeFixture(); let service = LibraryStub(item)
        let model = WardrobeDetailModel(item: item, client: service, images: ImageProcessor(), isolation: VisionImageIsolator())
        model.edit.fields.name = "unsaved"
        let removed = await model.remove()
        XCTAssertFalse(removed); XCTAssertTrue(model.conflict); XCTAssertEqual(model.edit.fields.name, "unsaved")
        await model.reload()
        XCTAssertFalse(model.hasChanges); XCTAssertFalse(model.conflict); XCTAssertEqual(model.edit.fields.name, item.name)
    }
    func testRestoringRemoteOriginalDoesNotReuploadOrChangeSavedPhoto() async throws {
        let item = wardrobeFixture(); let service = LibraryStub(item)
        let original = try CoreTests.fixtureImage(width: 120, height: 160)
        await service.setPhoto(original)
        let model = WardrobeDetailModel(item: item, client: service, images: ImageProcessor(), isolation: StubIsolator(output: try CoreTests.fixtureImage(width: 80, height: 100)))
        await model.cutout(.front)
        XCTAssertTrue(model.hasChanges); XCTAssertTrue(model.hasOriginal(.front))
        model.restorePhoto(.front)
        XCTAssertNil(model.edit.photos[.front]); XCTAssertFalse(model.hasChanges)
        XCTAssertEqual(model.previews[.front], original)
    }
    func testRemovingOneViewDoesNotChangeOtherViews() {
        let item = wardrobeFixture()
        let model = WardrobeDetailModel(item: item, client: LibraryStub(item), images: ImageProcessor(), isolation: VisionImageIsolator())
        model.removePhoto(.side)
        XCTAssertEqual(model.edit.photos, [.side: ""])
        XCTAssertTrue(model.hasChanges)
    }
}
#endif
