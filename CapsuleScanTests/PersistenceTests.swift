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

final class EditorTests: XCTestCase {
    @MainActor private func services(extractor: (any ItemExtractor)? = nil) throws -> AppServices {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        return AppServices(container: container, media: MemoryMedia(), credentials: MemoryCredentials(), transport: StubHTTP(), extractor: extractor)
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
        let saved = await editor.save(); XCTAssertTrue(saved)
        XCTAssertEqual(try services.container.mainContext.fetchCount(FetchDescriptor<WardrobeItem>()), 1)
    }
    @MainActor func testExtractionFailureFallsBackAndUnnamedLocalSaveWorks() async throws {
        let services = try services(extractor: FailingExtractor())
        let editor = ItemEditorModel(image: try CoreTests.fixtureImage(width: 100, height: 100), services: services)
        await editor.start()
        XCTAssertEqual(editor.fields.color, "blue"); XCTAssertNil(editor.fields.category)
        XCTAssertFalse(editor.extracting)
        let saved = await editor.save(); XCTAssertTrue(saved)
        let item = try XCTUnwrap(editor.record)
        XCTAssertEqual(item.fields.name, "")
        XCTAssertEqual(item.capsuleSaveState, .notSaved)
        XCTAssertNil(item.capsuleIdempotencyKey)
    }
    @MainActor func testAuthenticationFailureKeepsLocalItemAndDisconnects() async throws {
        let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let credentials = MemoryCredentials(); await credentials.write(UUID().uuidString, for: .capsuleToken)
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
}
