#if canImport(CapsuleScan)
import XCTest
@testable import CapsuleScan

actor WishlistStub: WardrobeServing {
    var current: RemoteWardrobeItem
    var failure: Error? = WardrobeError.unavailable
    var mutations: [WardrobeMutation] = []
    var operations: [String] = []
    init(_ item: RemoteWardrobeItem) { current = item }
    func page(cursor: Int64) -> WardrobePage { .init(items: [current], cursor: current.revision, hasMore: false) }
    func item(id: String) -> RemoteWardrobeItem { current }
    func photo(item: RemoteWardrobeItem, view: GarmentView) throws -> Data { throw WardrobeError.missing }
    private func record(_ mutation: WardrobeMutation, _ operation: String) throws { mutations.append(mutation); operations.append(operation); if let failure { throw failure } }
    func update(id: String, mutation: WardrobeMutation) throws { try record(mutation,"update") }
    func remove(id: String, mutation: WardrobeMutation) throws { try record(mutation,"delete") }
    func create(mutation: WardrobeMutation) throws -> String { try record(mutation,"create"); return current.id }
    func purchase(id: String, mutation: WardrobeMutation) throws -> String { try record(mutation,"purchase"); return id }
    func checkPrice(id: String, mutation: WardrobeMutation) throws -> Bool { try record(mutation,"price"); return true }
    func setFailure(_ error: Error?) { failure = error }
}
@MainActor final class WishlistModelTests: XCTestCase {
    private func model(_ item: RemoteWardrobeItem, _ client: WishlistStub) -> WardrobeDetailModel {
        .init(item:item,client:client,images:ImageProcessor(),isolation:VisionImageIsolator(),collection:.wishlist)
    }
    func testNewItemRetriesSameBodyThenChangesKeyAfterEdit() async {
        let item = RemoteWardrobeItem.empty(); let client = WishlistStub(item); let model = model(item,client)
        model.edit.fields.name = "shirt"; model.edit.rating = Decimal(string:"4.5")
        _ = await model.save(); _ = await model.save()
        var requests = await client.mutations; XCTAssertEqual(requests.count,2); XCTAssertEqual(requests[0],requests[1])
        model.edit.fields.name = "cotton shirt"; _ = await model.save()
        requests = await client.mutations; XCTAssertNotEqual(requests[1].key,requests[2].key)
        await client.setFailure(nil); let saved = await model.save(); XCTAssertTrue(saved)
        let operations = await client.operations; XCTAssertTrue(operations.allSatisfy { $0 == "create" })
    }
    func testPriceRetryAndMoveRetainTheirOwnIdempotencyKeys() async {
        let item = wardrobeFixture(); let client = WishlistStub(item); let model = model(item,client)
        await model.checkPrice(url:"https://shop.test/item"); await model.checkPrice(url:"https://shop.test/item")
        _ = await model.purchase(); _ = await model.purchase()
        let requests = await client.mutations
        XCTAssertEqual(requests.count,4); XCTAssertEqual(requests[0],requests[1]); XCTAssertEqual(requests[2],requests[3]); XCTAssertNotEqual(requests[0].key,requests[2].key)
    }
    func testPriceAndPurchaseCannotDiscardUnsavedChanges() async {
        let item = wardrobeFixture(); let client = WishlistStub(item); let model = model(item,client)
        model.edit.rating = 5
        await model.checkPrice(url:"https://shop.test/item"); let moved = await model.purchase()
        XCTAssertFalse(moved); XCTAssertEqual(model.edit.rating,5)
        let requests = await client.mutations; XCTAssertTrue(requests.isEmpty)
    }
    func testIdempotencyConflictRetriesOnlyOnceAndRevisionConflictPreservesEdits() async {
        let item = wardrobeFixture(); let client = WishlistStub(item); let model = model(item,client)
        await client.setFailure(ScanError.idempotencyConflict)
        _ = await model.purchase()
        var requests = await client.mutations; XCTAssertEqual(requests.count,2); XCTAssertNotEqual(requests[0].key,requests[1].key)
        model.edit.rating = 4; await client.setFailure(WardrobeError.conflict)
        let saved = await model.save(); XCTAssertFalse(saved); XCTAssertTrue(model.conflict); XCTAssertEqual(model.edit.rating,4)
        requests = await client.mutations; XCTAssertEqual(requests.count,3)
    }
}
#endif
