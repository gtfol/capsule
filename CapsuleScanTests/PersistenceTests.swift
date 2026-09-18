import XCTest
import SwiftData
@testable import CapsuleScan

final class PersistenceTests: XCTestCase {
    @MainActor func testFreshDiskStorePersistsAcrossContainerRecreation() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let item = ItemRecord(localImageReference: UUID().uuidString + ".jpg", fields: ItemFields(name: "shirt", price: "19.99"))
        do {
            let first = try SwiftDataItemStore.makeContainer(in: directory)
            try SwiftDataItemStore(context: first.mainContext).save(item)
        }
        let reopened = try SwiftDataItemStore.makeContainer(in: directory)
        XCTAssertEqual(try SwiftDataItemStore(context: reopened.mainContext).record(id: item.id), item)
    }
    @MainActor func testSaveRoundTripAndInterruptedRecovery() async throws {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let store = SwiftDataItemStore(context: container.mainContext)
        var item = ItemRecord(localImageReference: UUID().uuidString + ".jpg", fields: ItemFields(name: "", color: "washed black", price: "19.99"))
        item.capsuleSaveState = .saving
        item.capsuleIdempotencyKey = UUID().uuidString
        item.capsuleRequestReference = UUID().uuidString + ".json"
        try store.save(item)
        XCTAssertEqual(try store.record(id: item.id), item)
        try store.recoverInterruptedSaves()
        let recovered = try store.record(id: item.id)
        XCTAssertEqual(recovered.capsuleSaveState, .failed)
        XCTAssertEqual(recovered.capsuleIdempotencyKey, item.capsuleIdempotencyKey)
        XCTAssertEqual(recovered.capsuleRequestReference, item.capsuleRequestReference)
        XCTAssertEqual(recovered.fields.price, "19.99")
    }
}

actor DelayedExtractor: ItemExtractor {
    private var waiter: CheckedContinuation<ExtractedDraft, Never>?
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    func extract(image: Data) async -> ExtractedDraft {
        await withCheckedContinuation { continuation in
            waiter = continuation
            startWaiters.forEach { $0.resume() }; startWaiters.removeAll()
        }
    }
    func waitUntilStarted() async {
        if waiter != nil { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }
    func finish() { waiter?.resume(returning: ExtractedDraft(name: "guessed name", brand: "example", category: "jackets", color: "blue")); waiter = nil }
}
struct FailingExtractor: ItemExtractor {
    func extract(image: Data) async throws -> ExtractedDraft { throw ScanError.extraction }
}
struct FailingIsolator: ImageIsolating {
    func isolate(_ image: Data) async throws -> ProcessedImage { throw IsolationError.noSubject }
}
struct StubIsolator: ImageIsolating {
    let output: Data
    func isolate(_ image: Data) async throws -> ProcessedImage { ProcessedImage(data: output, width: 100, height: 100) }
}
actor DelayedIsolator: ImageIsolating {
    private var waiter: CheckedContinuation<ProcessedImage, Never>?
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    func isolate(_ image: Data) async -> ProcessedImage {
        await withCheckedContinuation { continuation in
            waiter = continuation
            startWaiters.forEach { $0.resume() }; startWaiters.removeAll()
        }
    }
    func waitUntilStarted() async {
        if waiter != nil { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }
    func finish(_ image: Data) {
        waiter?.resume(returning: ProcessedImage(data: image, width: 100, height: 100)); waiter = nil
    }
}

final class EditorTests: XCTestCase {
    @MainActor private func services(extractor: (any ItemExtractor)? = nil, isolation: any ImageIsolating = FailingIsolator()) throws -> AppServices {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        return AppServices(container: container, media: MemoryMedia(), credentials: MemoryCredentials(), transport: StubHTTP(), extractor: extractor, isolation: isolation)
    }
    @MainActor func testCutoutIsOnlyWrittenAfterSaveAndOriginalCanBeSelected() async throws {
        let original = try CoreTests.fixtureImage(width: 100, height: 100)
        let cutout = try CoreTests.fixtureImage(width: 50, height: 80)
        let services = try services(isolation: StubIsolator(output: cutout))
        let editor = ItemEditorModel(image: original, services: services)
        await editor.start()
        XCTAssertEqual(editor.image, cutout); XCTAssertTrue(editor.usingCutout)
        let media = services.media as! MemoryMedia
        let before = await media.files; XCTAssertTrue(before.isEmpty)
        XCTAssertEqual(try services.container.mainContext.fetchCount(FetchDescriptor<WardrobeItem>()), 0)
        editor.selectCutout(false); XCTAssertEqual(editor.image, original)
        editor.selectCutout(true); XCTAssertEqual(editor.image, cutout)
        let saved = await editor.saveDraft(); XCTAssertTrue(saved)
        let record = try XCTUnwrap(editor.record)
        let stored = try await media.read(record.localImageReference)
        XCTAssertEqual(stored, cutout)
        let reopened = ItemEditorModel(record: record, services: services)
        await reopened.start()
        XCTAssertEqual(reopened.image, cutout)
    }
    @MainActor func testIsolationFailureKeepsOriginalAndStillAllowsSave() async throws {
        let original = try CoreTests.fixtureImage(width: 100, height: 100)
        let services = try services()
        let editor = ItemEditorModel(image: original, services: services)
        await editor.start()
        XCTAssertEqual(editor.image, original); XCTAssertFalse(editor.isolating)
        XCTAssertNotNil(editor.isolationMessage); XCTAssertEqual(editor.fields.color, "blue")
        let saved = await editor.saveDraft(); XCTAssertTrue(saved)
        let stored = try await services.media.read(XCTUnwrap(editor.record).localImageReference)
        XCTAssertEqual(stored, original)
    }
    @MainActor func testLateCutoutCannotReplaceSavedOriginal() async throws {
        let original = try CoreTests.fixtureImage(width: 100, height: 100)
        let isolation = DelayedIsolator()
        let services = try services(isolation: isolation)
        let editor = ItemEditorModel(image: original, services: services)
        let task = Task { await editor.start() }
        await isolation.waitUntilStarted()
        let saved = await editor.saveDraft(); XCTAssertTrue(saved)
        await isolation.finish(Data([1, 2, 3])); await task.value
        XCTAssertEqual(editor.image, original); XCTAssertNil(editor.cutout)
        let stored = try await services.media.read(XCTUnwrap(editor.record).localImageReference)
        XCTAssertEqual(stored, original)
    }
    @MainActor func testUseOriginalDuringIsolationIgnoresLateResult() async throws {
        let original = try CoreTests.fixtureImage(width: 100, height: 100)
        let isolation = DelayedIsolator()
        let services = try services(isolation: isolation)
        let editor = ItemEditorModel(image: original, services: services)
        let task = Task { await editor.start() }
        await isolation.waitUntilStarted()
        editor.selectCutout(false)
        await isolation.finish(Data([1, 2, 3])); await task.value
        XCTAssertEqual(editor.image, original); XCTAssertFalse(editor.usingCutout)
        XCTAssertFalse(editor.isolating); XCTAssertNil(editor.cutout)
    }
    @MainActor func testLateExtractionCannotOverwriteUserEditsOrSaveAutomatically() async throws {
        let extractor = DelayedExtractor()
        let services = try services(extractor: extractor)
        let editor = ItemEditorModel(image: try CoreTests.fixtureImage(width: 100, height: 100), services: services)
        let task = Task { await editor.start() }
        await extractor.waitUntilStarted()
        editor.touched(.name); editor.fields.name = "my shirt"
        editor.touched(.category); editor.fields.category = .tops
        await extractor.finish(); await task.value
        XCTAssertEqual(editor.fields.name, "my shirt")
        XCTAssertEqual(editor.fields.category, .tops)
        XCTAssertEqual(editor.fields.color, "blue")
        XCTAssertEqual(try services.container.mainContext.fetchCount(FetchDescriptor<WardrobeItem>()), 0)
        let media = services.media as! MemoryMedia
        let files = await media.files; XCTAssertTrue(files.isEmpty)
        let saved = await editor.saveDraft(); XCTAssertTrue(saved)
        XCTAssertEqual(try services.container.mainContext.fetchCount(FetchDescriptor<WardrobeItem>()), 1)
    }
    @MainActor func testExtractionFailureFallsBackAndUnnamedDraftSaveWorks() async throws {
        let services = try services(extractor: FailingExtractor())
        let editor = ItemEditorModel(image: try CoreTests.fixtureImage(width: 100, height: 100), services: services)
        await editor.start()
        XCTAssertEqual(editor.fields.color, "blue"); XCTAssertNil(editor.fields.category)
        XCTAssertFalse(editor.extracting)
        let saved = await editor.saveDraft(); XCTAssertTrue(saved)
        let item = try XCTUnwrap(editor.record)
        XCTAssertEqual(item.fields.name, "")
        XCTAssertEqual(item.capsuleSaveState, .notSaved)
        XCTAssertNil(item.capsuleIdempotencyKey)
    }
    @MainActor func testAuthenticationFailureKeepsLocalItemAndDisconnects() async throws {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let credentials = MemoryCredentials()
        try await credentials.storeCapsuleLogin(CapsuleLogin(token: UUID().uuidString, user: CapsuleUser(id: UUID().uuidString, name: "test")))
        let services = AppServices(container: container, media: MemoryMedia(), credentials: credentials, transport: StubHTTP(status: 401))
        await services.refreshCredentials()
        let editor = ItemEditorModel(image: try CoreTests.fixtureImage(width: 100, height: 100), services: services)
        editor.fields.name = "shirt"
        let saved = await editor.save(); XCTAssertFalse(saved)
        XCTAssertFalse(services.connected)
        let record = try XCTUnwrap(editor.record)
        XCTAssertEqual(record.capsuleSaveState, .failed)
        XCTAssertEqual(try services.items.record(id: record.id).fields.name, "shirt")
        XCTAssertNotNil(record.capsuleIdempotencyKey)
    }
    @MainActor func testDisconnectedSaveCannotPretendItSavedToCapsule() async throws {
        let services = try services()
        let editor = ItemEditorModel(image: try CoreTests.fixtureImage(width: 100, height: 100), services: services)
        editor.fields.name = "shirt"
        let saved = await editor.save(); XCTAssertFalse(saved)
        XCTAssertNil(editor.record)
        XCTAssertEqual(try services.container.mainContext.fetchCount(FetchDescriptor<WardrobeItem>()), 0)
        let draft = await editor.saveDraft(); XCTAssertTrue(draft)
    }
    @MainActor func testSuccessfulSaveKeepsReceiptButRemovesLocalPhotoAndRequest() async throws {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let vault = MemoryCredentials()
        let user = CapsuleUser(id: UUID().uuidString, name: "test")
        try await vault.storeCapsuleLogin(CapsuleLogin(token: UUID().uuidString, user: user))
        let http = StubHTTP(body: Data("{\"id\":\"\(UUID().uuidString)\"}".utf8))
        let media = MemoryMedia()
        let services = AppServices(container: container, media: media, credentials: vault, transport: http)
        await services.refreshCredentials()
        let editor = ItemEditorModel(image: try CoreTests.fixtureImage(width: 100, height: 100), services: services)
        editor.fields.name = "shirt"
        let saved = await editor.save(); XCTAssertTrue(saved)
        let receipt = try XCTUnwrap(editor.record)
        XCTAssertTrue(receipt.capsuleSaveState.completed)
        XCTAssertEqual(receipt.capsuleUserID, user.id)
        let files = await media.files; XCTAssertTrue(files.isEmpty)
        let savedAgain = await editor.save(); XCTAssertTrue(savedAgain)
        let requests = await http.requests; XCTAssertEqual(requests.count, 1)
    }
    @MainActor func testDraftCannotBeSentToAnotherAccount() async throws {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let vault = MemoryCredentials()
        try await vault.storeCapsuleLogin(CapsuleLogin(token: UUID().uuidString, user: CapsuleUser(id: "other", name: "test")))
        let http = StubHTTP()
        let services = AppServices(container: container, media: MemoryMedia(), credentials: vault, transport: http)
        await services.refreshCredentials()
        var item = ItemRecord(localImageReference: UUID().uuidString + ".jpg", fields: ItemFields(name: "shirt"))
        item.capsuleUserID = "owner"
        try services.items.save(item)
        let editor = ItemEditorModel(record: item, services: services)
        let saved = await editor.save(); XCTAssertFalse(saved)
        XCTAssertEqual(editor.error, ScanError.wrongAccount.localizedDescription)
        let requests = await http.requests; XCTAssertTrue(requests.isEmpty)
        XCTAssertEqual(try services.items.record(id: item.id), item)
    }
}

@MainActor final class TestBrowser: BrowserAuthenticating {
    var cancel = false
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        if cancel { throw SignInError.cancelled }
        let state = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "state" }!.value!
        return URL(string: "\(callbackScheme)://auth/callback?code=\(try CapsuleSignInRequest().verifier)&state=\(state)")!
    }
}
final class SessionTests: XCTestCase {
    @MainActor func testPhotoDetailsRequiresConsentAndRemovalDisablesIt() async throws {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let vault = MemoryCredentials()
        await vault.write(UUID().uuidString, for: .visionAPIKey)
        let http = StubHTTP()
        let services = AppServices(container: container, media: MemoryMedia(), credentials: vault, transport: http)
        await services.refreshCredentials()
        XCTAssertTrue(services.hasVisionKey)
        XCTAssertFalse(services.visionEnabled)
        // Existing installations must not send photos just because a key was saved earlier.
        let image = try await services.images.jpeg(CoreTests.fixtureImage(width: 300, height: 400), maxEdge: 1600, quality: 0.85)
        let draft = try await services.extractor().extract(image: image.data)
        XCTAssertEqual(draft.color, "blue")
        let requests = await http.requests
        XCTAssertTrue(requests.isEmpty)
        try await services.enableVision(key: nil)
        XCTAssertTrue(services.visionEnabled)
        await services.refreshCredentials()
        XCTAssertTrue(services.visionEnabled)
        try await services.removeVisionKey()
        XCTAssertFalse(services.visionEnabled)
        XCTAssertFalse(services.hasVisionKey)
        let consent = await vault.read(.visionPhotoConsent)
        XCTAssertNil(consent)
    }

    @MainActor func testSignInRestoresAccountOnRelaunchAndNeverCreatesItems() async throws {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let vault = MemoryCredentials()
        let login = CapsuleLogin(token: "capsule_" + (try CapsuleSignInRequest().verifier), user: CapsuleUser(id: UUID().uuidString, name: "test"))
        let services = AppServices(container: container, media: MemoryMedia(), credentials: vault,
                                   transport: StubHTTP(body: try JSONEncoder().encode(login)), browser: TestBrowser())
        await services.signIn()
        XCTAssertTrue(services.connected); XCTAssertEqual(services.user, login.user)
        let restarted = AppServices(container: container, media: MemoryMedia(), credentials: vault, transport: StubHTTP(error: URLError(.notConnectedToInternet)))
        await restarted.refreshCredentials()
        XCTAssertTrue(restarted.connected); XCTAssertEqual(restarted.user, login.user)
        XCTAssertEqual(try container.mainContext.fetchCount(FetchDescriptor<WardrobeItem>()), 0)
    }
    @MainActor func testCancelledSignInDoesNotConnectOrSaveAnything() async throws {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let vault = MemoryCredentials(); let http = StubHTTP(); let browser = TestBrowser(); browser.cancel = true
        let services = AppServices(container: container, media: MemoryMedia(), credentials: vault, transport: http, browser: browser)
        await services.signIn()
        XCTAssertFalse(services.connected); XCTAssertNil(services.connectionMessage)
        let values = await vault.values; XCTAssertTrue(values.isEmpty)
        let requests = await http.requests; XCTAssertTrue(requests.isEmpty)
    }
}
