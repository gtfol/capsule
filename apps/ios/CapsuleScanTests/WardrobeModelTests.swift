#if canImport(CapsuleScan)
import XCTest
@testable import CapsuleScan

actor LibraryStub: WardrobeServing {
    var pages: [WardrobePage]
    var current: RemoteWardrobeItem
    var failUpdate = true
    var photoData: Data?
    var updates: [WardrobeMutation] = []
    var cursors: [Int64] = []
    init(_ item: RemoteWardrobeItem, pages: [WardrobePage] = []) { current = item; self.pages = pages }
    func page(cursor: Int64) -> WardrobePage { cursors.append(cursor); return pages.removeFirst() }
    func item(id: String) -> RemoteWardrobeItem { current }
    func photo(item: RemoteWardrobeItem, view: GarmentView) throws -> Data { guard let photoData else { throw WardrobeError.unavailable }; return photoData }
    func setPhoto(_ data: Data) { photoData = data }
    func update(id: String, mutation: WardrobeMutation) throws { updates.append(mutation); if failUpdate { throw WardrobeError.unavailable } }
    func remove(id: String, mutation: WardrobeMutation) throws { throw WardrobeError.conflict }
    func succeed() { failUpdate = false }
}
@MainActor final class WardrobeModelTests: XCTestCase {
    func testEmptyIntermediatePageContinuesAndDeduplicatesLatestRevision() async {
        let item = wardrobeFixture()
        let service = LibraryStub(item, pages: [.init(items: [], cursor: 1, hasMore: true), .init(items: [item, item], cursor: 12, hasMore: false)])
        let model = WardrobeModel()
        await model.load(client: service)
        XCTAssertTrue(model.loaded); XCTAssertNil(model.error); XCTAssertEqual(model.items.count, 1)
        let cursors = await service.cursors; XCTAssertEqual(cursors, [0, 1])
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
