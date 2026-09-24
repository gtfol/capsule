#if canImport(CapsuleScan)
import XCTest
import ImageIO
@testable import CapsuleScan

private actor PhotoProbe {
    var calls = 0
    var active = 0
    var peak = 0
    func download() async throws -> Data {
        calls += 1; active += 1; peak = max(peak, active)
        defer { active -= 1 }
        try await Task.sleep(for: .milliseconds(20))
        return Data([1, 2, 3])
    }
}
private actor BlockedPhoto {
    private var continuation: CheckedContinuation<Data, Error>?
    var started = false
    func download() async throws -> Data {
        started = true
        return try await withCheckedThrowingContinuation { continuation = $0 }
    }
    func release() { continuation?.resume(returning: Data([1])); continuation = nil }
}

private actor FailingPhoto {
    var calls = 0
    let error: WardrobeError
    init(_ error: WardrobeError) { self.error = error }
    func download() throws -> Data { calls += 1; if calls == 1 { throw error }; return Data([9]) }
}
final class PhotoLoadingTests: XCTestCase {
    func testTransientFailureRetriesOnceButAuthenticationAndRateLimitsDoNot() async throws {
        let cache = WardrobePhotoCache(), temporary = FailingPhoto(.unavailable)
        let result = try await cache.load(key: "temporary") { try await temporary.download() }
        XCTAssertEqual(result, Data([9]))
        let calls = await temporary.calls; XCTAssertEqual(calls, 2)
        for expected in [WardrobeError.reconnect, .offline, .rateLimited, .missing] {
            let failure = FailingPhoto(expected)
            do { _ = try await cache.load(key: String(describing: expected)) { try await failure.download() }; XCTFail() }
            catch { XCTAssertEqual(error as? WardrobeError, expected) }
            let count = await failure.calls; XCTAssertEqual(count, 1)
        }
    }

    func testConcurrentViewersShareOneDownload() async throws {
        let cache = WardrobePhotoCache(), probe = PhotoProbe()
        try await withThrowingTaskGroup(of: Data.self) { group in
            for _ in 0..<20 { group.addTask { try await cache.load(key: "owner:piece:front:1") { try await probe.download() } } }
            for try await result in group { XCTAssertEqual(result, Data([1, 2, 3])) }
        }
        let calls = await probe.calls; XCTAssertEqual(calls, 1)
    }
    func testDownloadsAreBoundedWhileScrolling() async throws {
        let cache = WardrobePhotoCache(), probe = PhotoProbe()
        try await withThrowingTaskGroup(of: Data.self) { group in
            for index in 0..<30 { group.addTask { try await cache.load(key: String(index)) { try await probe.download() } } }
            for try await _ in group {}
        }
        let peak = await probe.peak, calls = await probe.calls
        XCTAssertEqual(calls, 30); XCTAssertLessThanOrEqual(peak, 4)
    }
    func testCancelledQueuedPhotoIsNotDownloaded() async throws {
        let cache = WardrobePhotoCache(concurrency: 1), blocked = BlockedPhoto(), probe = PhotoProbe()
        let first = Task { try await cache.load(key: "first") { try await blocked.download() } }
        while !(await blocked.started) { await Task.yield() }
        let queued = Task { try await cache.load(key: "offscreen") { try await probe.download() } }
        queued.cancel()
        do { _ = try await queued.value; XCTFail("cancelled viewer received a photo") } catch is CancellationError {} catch { XCTFail("unexpected error") }
        await blocked.release(); _ = try await first.value
        let calls = await probe.calls; XCTAssertEqual(calls, 0)
    }
    func testClearRejectsInflightResponseAndNeverRepopulatesCache() async throws {
        let cache = WardrobePhotoCache(), blocked = BlockedPhoto()
        let pending = Task { try await cache.load(key: "owner:photo") { try await blocked.download() } }
        while !(await blocked.started) { await Task.yield() }
        await cache.clear(); await blocked.release()
        do { _ = try await pending.value; XCTFail("cleared photo escaped") } catch is CancellationError {} catch { XCTFail("unexpected error") }
        let fresh = try await cache.load(key: "owner:photo") { Data([2]) }
        XCTAssertEqual(fresh, Data([2]))
    }
    func testLRUEvictsOldestUnusedPhotoAndSeparatesOwners() async throws {
        let cache = WardrobePhotoCache(byteLimit: 2)
        _ = try await cache.load(key: "a") { Data([1]) }
        _ = try await cache.load(key: "b") { Data([2]) }
        let hit = try await cache.load(key: "a") { XCTFail("cached photo downloaded"); return Data() }
        XCTAssertEqual(hit, Data([1]))
        _ = try await cache.load(key: "c") { Data([3]) }
        let evicted = try await cache.load(key: "b") { Data([4]) }
        XCTAssertEqual(evicted, Data([4]))
        let other = try await cache.load(key: "other-account:a") { Data([5]) }
        XCTAssertEqual(other, Data([5]))
    }
    func testThumbnailIsBoundedAndDetailReusesDownload() async throws {
        let cache = WardrobePhotoCache(), data = try CoreTests.fixtureImage(width: 1800, height: 2400)
        let small = try await cache.image(key: "photo", maxPixelSize: 600) { data }
        XCTAssertEqual(small.width, 450); XCTAssertEqual(small.height, 600)
        let large = try await cache.image(key: "photo", maxPixelSize: 1600) { XCTFail("detail redownloaded cached original"); return Data() }
        XCTAssertEqual(large.width, 1200); XCTAssertEqual(large.height, 1600)
        let again = try await cache.image(key: "photo", maxPixelSize: 600) { XCTFail(); return Data() }
        XCTAssertTrue(small === again)
    }
    func testTransparentThumbnailAndInvalidImageRetry() async throws {
        let cache = WardrobePhotoCache(), png = try IsolationTests.fixture()
        let image = try await cache.image(key: "cutout", maxPixelSize: 64) { png }
        XCTAssertTrue([CGImageAlphaInfo.premultipliedFirst, .premultipliedLast, .first, .last].contains(image.alphaInfo))
        do { _ = try await cache.image(key: "retry", maxPixelSize: 64) { Data("invalid".utf8) }; XCTFail() } catch {}
        let recovered = try await cache.image(key: "retry", maxPixelSize: 64) { png }
        XCTAssertLessThanOrEqual(max(recovered.width, recovered.height), 64)
    }
    @MainActor func testOrdinaryReloadRetainsPhotosAndManualRefreshInvalidatesThem() async {
        let item = wardrobeFixture(), model = WardrobeModel()
        let page = WardrobePage(items: [item], cursor: 12, hasMore: false)
        let client = LibraryStub(item, pages: [page, page, page])
        await model.load(client: client); let version = model.photoReloadID
        await model.load(client: client); XCTAssertEqual(model.photoReloadID, version)
        await model.load(client: client, refreshPhotos: true); XCTAssertNotEqual(model.photoReloadID, version)
        let refresh = PhotoRefreshState()
        let initial = refresh.version(account: "owner", collection: "wardrobe")
        refresh.refresh(account: "owner", collection: "wardrobe")
        XCTAssertNotEqual(initial, refresh.version(account: "owner", collection: "wardrobe"))
        XCTAssertEqual(initial, refresh.version(account: "other", collection: "wardrobe"))
        XCTAssertEqual(initial, refresh.version(account: "owner", collection: "wishlist"))
    }
}
#endif
