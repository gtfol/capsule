import XCTest
import Foundation
#if canImport(CapsuleScan)
@testable import CapsuleScan
#else
@testable import CapsuleScanCore
#endif

final class WishlistTests: XCTestCase {
    func testWishlistEditsDoNotOverwriteSourcePricesAndAllowClearingRating() throws {
        var item = wardrobeFixture(); item.price = "19.90"; item.rating = Decimal(string: "4.5")
        var edit = WardrobeEdit(item: item)
        edit.fields.name = "new name"
        var value = try XCTUnwrap(JSONSerialization.jsonObject(with: edit.encoded(revision: 12, collection: .wishlist)) as? [String:Any])
        XCTAssertNil(value["price"]); XCTAssertNil(value["currency"])
        XCTAssertEqual(value["rating"] as? Double, 4.5)
        edit.rating = nil; edit.fields.price = "15.50"
        value = try XCTUnwrap(JSONSerialization.jsonObject(with: edit.encoded(revision: 12, collection: .wishlist)) as? [String:Any])
        XCTAssertTrue(value["rating"] is NSNull); XCTAssertEqual(value["price"] as? String, "15.5")
        edit.rating = Decimal(string: "0.25"); XCTAssertThrowsError(try edit.encoded(revision: 12, collection: .wishlist))
    }
    func testWishlistCreationUsesExplicitFieldsAndNoRevision() throws {
        var edit = WardrobeEdit(item: .empty()); edit.fields.name = "shirt"; edit.rating = 5
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: edit.encoded(revision: 0, collection: .wishlist)) as? [String:Any])
        XCTAssertEqual(value["fetch"] as? Bool, false); XCTAssertNil(value["expectedRevision"])
        XCTAssertEqual(value["rating"] as? Int, 5); XCTAssertEqual(value["name"] as? String, "shirt")
        edit.fields.name = ""; XCTAssertThrowsError(try edit.encoded(revision: 0, collection: .wishlist))
    }
    func testSortPutsUnknownRatingsAndPriceDropsLast() {
        var a = wardrobeFixture(); var b = wardrobeFixture(); var c = wardrobeFixture()
        a.createdAt = 10; b.createdAt = 20; c.createdAt = 30
        b.rating = 3; c.rating = Decimal(string: "4.5"); b.priceDrop = -10; c.priceDrop = 20
        XCTAssertEqual(WishlistSort.recent.sorted([a,b,c]).map(\.id), [c.id,b.id,a.id])
        XCTAssertEqual(WishlistSort.rating.sorted([a,b,c]).map(\.id), [c.id,b.id,a.id])
        XCTAssertEqual(WishlistSort.drop.sorted([a,b,c]).map(\.id), [c.id,b.id,a.id])
    }
    func testWishlistEndpointsHeadersAndReceipts() async throws {
        let item = wardrobeFixture(); let id = item.id
        let credentials = MemoryCredentials()
        try await credentials.storeCapsuleLogin(.init(token: "test-only", user: .init(id: "owner", name: "owner")))
        let wishlist = Data("{\"id\":\"\(id)\",\"collection\":\"wishlist\",\"priceFetched\":true,\"sync\":{\"status\":\"saved_to_cloud\",\"revision\":13}}".utf8)
        let wardrobe = Data("{\"id\":\"\(id)\",\"collection\":\"wardrobe\",\"sync\":{\"status\":\"saved_to_cloud\",\"revision\":14}}".utf8)
        let detail = try JSONSerialization.data(withJSONObject: ["item":JSONSerialization.jsonObject(with: JSONEncoder().encode(item))])
        let http = WardrobeHTTP([.init(data: wishlist,status:200),.init(data: detail,status:200),.init(data: wishlist,status:200),.init(data: wardrobe,status:200)])
        let client = CapsuleWardrobeClient(credentials:credentials,transport:http,expectedUserID:"owner",collection:.wishlist)
        let mutation = WardrobeMutation(body:Data("{}".utf8))
        let created = try await client.create(mutation:mutation); XCTAssertEqual(created,id)
        let loaded = try await client.item(id:id); XCTAssertEqual(loaded.id,id)
        let fetched = try await client.checkPrice(id:id,mutation:mutation); XCTAssertTrue(fetched)
        let moved = try await client.purchase(id:id,mutation:mutation); XCTAssertEqual(moved,id)
        let requests = await http.requests
        XCTAssertEqual(requests.map { $0.url!.path },["/api/v1/wishlist","/api/v1/wishlist/\(id)","/api/v1/wishlist/\(id)/price","/api/v1/wishlist/\(id)/purchase"])
        XCTAssertEqual(requests.map(\.httpMethod),["POST","GET","POST","POST"])
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField:"Authorization") == "Bearer test-only" })
        for i in [0,2,3] { XCTAssertEqual(requests[i].value(forHTTPHeaderField:"Idempotency-Key"),mutation.key) }
    }
    func testInvalidWishlistReceiptIsNotSuccess() async throws {
        let credentials = MemoryCredentials(); try await credentials.storeCapsuleLogin(.init(token:"test-only",user:.init(id:"owner",name:"owner")))
        let http = WardrobeHTTP([.init(data:Data("{}".utf8),status:200)])
        let client = CapsuleWardrobeClient(credentials:credentials,transport:http,expectedUserID:"owner",collection:.wishlist)
        do { _ = try await client.create(mutation:.init(body:Data("{}".utf8))); XCTFail() } catch { XCTAssertEqual(error as? WardrobeError,.unavailable) }
    }
    func testWishlistHistoryDecodesDecimalPrices() throws {
        let entry = try JSONDecoder().decode(WishlistPrice.self,from:Data(#"{"price":19.99,"currency":"USD","source_url":"https://shop.test/item","fetched_at":12345}"#.utf8))
        XCTAssertEqual(entry.price,Decimal(string:"19.99")); XCTAssertEqual(entry.fetched_at,12345)
    }
}
