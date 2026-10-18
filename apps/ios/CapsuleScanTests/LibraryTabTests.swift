#if canImport(CapsuleScan)
import XCTest
import SwiftUI
import SwiftData
@testable import CapsuleScan

@MainActor private final class TabSelection: ObservableObject {
    @Published var tab: LibraryTab = .wardrobe
    @Published var account: String? = "first"
}

@MainActor private struct TabHarness: View {
    @ObservedObject var selection: TabSelection
    let wardrobe: LibraryStub
    let wishlist: LibraryStub
    let outfits: OutfitStub
    var body: some View {
        if let account = selection.account {
            LibraryTabs(selection: selection.tab, wardrobe: wardrobe, wishlist: wishlist,
                        outfits: outfits, creatingOutfit: .constant(false),
                        addWardrobe: {}, addWishlist: {})
                .id(account)
        }
    }
}

@MainActor final class LibraryTabTests: XCTestCase {
    func testAllTabsPreloadWithPhotosAndAccountChangesDiscardTheirState() async throws {
        let wardrobe = LibraryStub(wardrobeFixture()), wishlist = LibraryStub(wardrobeFixture()), outfits = OutfitStub()
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let credentials = MemoryCredentials()
        try await credentials.storeCapsuleLogin(.init(token: UUID().uuidString, user: .init(id: "first", name: "test")))
        let services = AppServices(container: container, media: MemoryMedia(), credentials: credentials, transport: StubHTTP(), outfitTransport: StubHTTP())
        await services.refreshCredentials()
        let photo = try CoreTests.fixtureImage(width: 8, height: 12)
        await wardrobe.setPhoto(photo); await wishlist.setPhoto(photo)
        let selection = TabSelection()
        let host = UIHostingController(rootView: TabHarness(selection: selection, wardrobe: wardrobe, wishlist: wishlist, outfits: outfits).environmentObject(services))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 393, height: 852))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }

        try await settle()
        var wardrobeCalls = await wardrobe.cursors, wishlistCalls = await wishlist.cursors, outfitCalls = await outfits.cursors
        XCTAssertEqual(wardrobeCalls, [0]); XCTAssertEqual(wishlistCalls, [0]); XCTAssertEqual(outfitCalls, [0])
        // Hidden tabs also warm their visible grid photos before the first tap.
        let wardrobePhotos = await wardrobe.photoRequests, wishlistPhotos = await wishlist.photoRequests, outfitPhotos = await outfits.photoRequests
        XCTAssertGreaterThan(wardrobePhotos, 0); XCTAssertGreaterThan(wishlistPhotos, 0); XCTAssertGreaterThan(outfitPhotos, 0)

        for tab in [LibraryTab.wishlist, .outfits, .wardrobe, .wishlist, .wardrobe] {
            selection.tab = tab
            try await settle()
        }
        wardrobeCalls = await wardrobe.cursors; wishlistCalls = await wishlist.cursors; outfitCalls = await outfits.cursors
        XCTAssertEqual(wardrobeCalls, [0]); XCTAssertEqual(wishlistCalls, [0]); XCTAssertEqual(outfitCalls, [0])

        // A confirmed write invalidates the tabs without recreating the screens.
        services.wardrobeReloadID = UUID()
        try await settle()
        wardrobeCalls = await wardrobe.cursors; wishlistCalls = await wishlist.cursors; outfitCalls = await outfits.cursors
        XCTAssertEqual(wardrobeCalls, [0, 0]); XCTAssertEqual(wishlistCalls, [0, 0]); XCTAssertEqual(outfitCalls, [0, 0])

        selection.account = "second"
        try await settle()
        wardrobeCalls = await wardrobe.cursors; wishlistCalls = await wishlist.cursors; outfitCalls = await outfits.cursors
        XCTAssertEqual(wardrobeCalls, [0, 0, 0]); XCTAssertEqual(wishlistCalls, [0, 0, 0]); XCTAssertEqual(outfitCalls, [0, 0, 0])

        // Even signing back into the same account starts a fresh session cache.
        selection.account = nil
        try await settle()
        selection.account = "second"
        try await settle()
        wardrobeCalls = await wardrobe.cursors; wishlistCalls = await wishlist.cursors; outfitCalls = await outfits.cursors
        XCTAssertEqual(wardrobeCalls, [0, 0, 0, 0]); XCTAssertEqual(wishlistCalls, [0, 0, 0, 0]); XCTAssertEqual(outfitCalls, [0, 0, 0, 0])
    }

    func testSlowWardrobeDoesNotDelayOtherTabs() async throws {
        let wardrobe = LibraryStub(wardrobeFixture()), wishlist = LibraryStub(wardrobeFixture()), outfits = OutfitStub()
        await wardrobe.delayPages(true)
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let services = AppServices(container: container, media: MemoryMedia(), credentials: MemoryCredentials(), transport: StubHTTP(), outfitTransport: StubHTTP())
        let selection = TabSelection()
        let host = UIHostingController(rootView: TabHarness(selection: selection, wardrobe: wardrobe, wishlist: wishlist, outfits: outfits).environmentObject(services))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 393, height: 852))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        try await settle()
        let wardrobeCalls = await wardrobe.cursors, wishlistCalls = await wishlist.cursors, outfitCalls = await outfits.cursors
        XCTAssertEqual(wardrobeCalls, [0]); XCTAssertEqual(wishlistCalls, [0]); XCTAssertEqual(outfitCalls, [0])
        selection.account = nil
        try await settle()
    }

    private func settle() async throws {
        // Allow SwiftUI to reconcile the hierarchy and start its appearance tasks.
        try await Task.sleep(for: .milliseconds(300))
    }
}
#endif
