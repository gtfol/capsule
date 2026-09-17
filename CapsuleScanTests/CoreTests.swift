import XCTest
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
#if canImport(CapsuleScan)
@testable import CapsuleScan
#else
@testable import CapsuleScanCore
#endif

actor MemoryCredentials: CredentialStore {
    var values: [Credential: String] = [:]
    func read(_ credential: Credential) -> String? { values[credential] }
    func write(_ value: String?, for credential: Credential) { values[credential] = value }
}
actor StubHTTP: HTTPTransport {
    var requests: [URLRequest] = []
    let response: HTTPResult
    let error: URLError?
    init(status: Int = 200, body: Data = Data(), error: URLError? = nil) { response = HTTPResult(data: body, status: status); self.error = error }
    func send(_ request: URLRequest) throws -> HTTPResult {
        requests.append(request)
        if let error { throw error }
        return response
    }
}
actor MemoryMedia: MediaStoring {
    var files: [String: Data] = [:]
    func write(_ data: Data, extension suffix: String) -> String { let key = UUID().uuidString + "." + suffix; files[key] = data; return key }
    func read(_ reference: String) throws -> Data { guard let data = files[reference] else { throw ScanError.storage }; return data }
    func remove(_ reference: String) { files[reference] = nil }
}
struct SimplePayloads: PayloadPreparing {
    func prepare(fields: ItemFields, image: Data) throws -> Data { try CapsulePayload(fields: fields, jpeg: image).encoded() }
}
@MainActor final class MemoryItems: ItemStoring {
    var value: ItemRecord
    var commits: [ItemRecord] = []
    var rejectWrites = false
    init(_ value: ItemRecord) { self.value = value }
    func record(id: UUID) -> ItemRecord { value }
    func save(_ record: ItemRecord) throws {
        if rejectWrites { throw ScanError.storage }
        value = record; commits.append(record)
    }
}
actor ScriptedDestination: WardrobeDestination {
    enum Outcome { case success(Bool); case failure(ScanError) }
    var outcomes: [Outcome]
    var requests: [(Data, String)] = []
    init(_ outcomes: [Outcome]) { self.outcomes = outcomes }
    func save(body: Data, idempotencyKey: String) throws -> DestinationReceipt {
        requests.append((body, idempotencyKey))
        switch outcomes.removeFirst() {
        case .success(let duplicate): return DestinationReceipt(itemID: UUID().uuidString, duplicate: duplicate)
        case .failure(let error): throw error
        }
    }
}
actor LargeThenSmallImage: ImageProcessing {
    var attempts = 0
    func jpeg(_ data: Data, maxEdge: Int, quality: Double) -> ProcessedImage {
        attempts += 1
        return ProcessedImage(data: Data(repeating: 42, count: attempts == 1 ? 1_600_000 : 1_400_000), width: maxEdge, height: maxEdge)
    }
}

final class CoreTests: XCTestCase {
    func testEncodingOnlyAllowedFieldsAndDecimalStrings() throws {
        let fields = ItemFields(name: "shirt", brand: "example", category: .tops, color: "washed black", size: "m", price: "0.10", currency: "USD")
        let data = try CapsulePayload(fields: fields, jpeg: Data([1, 2, 3])).encoded()
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(json.keys), Set(["fetch", "name", "brand", "category", "color", "size", "price", "currency", "imageData"]))
        XCTAssertEqual(json["fetch"] as? Bool, false)
        XCTAssertEqual(json["price"] as? String, "0.1")
        XCTAssertEqual(json["imageData"] as? String, "data:image/jpeg;base64,AQID")
    }
    func testOmitUnsetCategoryAndEmptyOptionalFields() throws {
        let fields = ItemFields(name: "coat", currency: "")
        let json = try JSONSerialization.jsonObject(with: CapsulePayload(fields: fields, jpeg: nil).encoded()) as! [String: Any]
        XCTAssertEqual(Set(json.keys), Set(["fetch", "name"]))
        XCTAssertThrowsError(try CapsulePayload(fields: ItemFields(), jpeg: nil))
        XCTAssertNoThrow(try ItemFields().validated())
    }
    func testPriceIsDecimalSafeAndLocaleAware() throws {
        XCTAssertEqual(try Price.canonical("9007199254.123456"), "9007199254.123456")
        XCTAssertEqual(try Price.canonical("19,90", locale: Locale(identifier: "de_DE")), "19.9")
        XCTAssertNil(try Price.canonical(""))
        for invalid in ["NaN", "-1", "1e9", "$19", "1.2.3", "1,000.00", "12foo"] { XCTAssertThrowsError(try Price.canonical(invalid, locale: Locale(identifier: "en_US"))) }
    }
    func testCategoryValidation() {
        XCTAssertEqual(GarmentCategory.validated(" Jackets "), .jackets)
        for value in [nil, "", "dresses", "top", "unknown"] as [String?] { XCTAssertNil(GarmentCategory.validated(value)) }
        XCTAssertEqual(GarmentCategory.allCases.count, 5)
    }
    func testImageLimitingAndJPEGEncoding() async throws {
        let source = try Self.fixtureImage(width: 3200, height: 1800)
        let output = try await ImageProcessor().jpeg(source, maxEdge: 1600, quality: 0.85)
        XCTAssertEqual(output.width, 1600); XCTAssertEqual(output.height, 900)
        let image = try XCTUnwrap(CGImageSourceCreateWithData(output.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(image) as String?, UTType.jpeg.identifier)
        let small = try await ImageProcessor().jpeg(Self.fixtureImage(width: 120, height: 80), maxEdge: 1600, quality: 0.85)
        XCTAssertLessThanOrEqual(small.width, 1600)
    }
    func testInvalidPhotoFailsReadably() async {
        do { _ = try await ImageProcessor().jpeg(Data([0, 1, 2]), maxEdge: 1600, quality: 0.85); XCTFail() }
        catch { XCTAssertEqual(error as? ScanError, .invalidImage) }
    }
    func testPayloadRecompressesToBothLimits() async throws {
        let images = LargeThenSmallImage()
        let body = try await CapsulePayloadBuilder(images: images).prepare(fields: ItemFields(name: "coat"), image: Data())
        XCTAssertLessThan(body.count, 3_800_000)
        let attempts = await images.attempts
        XCTAssertEqual(attempts, 2)
        let json = try JSONSerialization.jsonObject(with: body) as! [String: Any]
        let url = try XCTUnwrap(json["imageData"] as? String)
        XCTAssertEqual(Data(base64Encoded: String(url.split(separator: ",")[1]))?.count, 1_400_000)
    }
    func testOnDeviceColorAndNoCategoryGuess() async throws {
        let draft = try await OnDeviceItemExtractor().extract(image: Self.fixtureImage(width: 200, height: 200))
        XCTAssertEqual(draft.color, "blue")
        XCTAssertNil(draft.category); XCTAssertNil(draft.brand)
    }
    func testCapsuleErrorMappingNeverUsesServerMessage() {
        let body = Data(#"{"error":{"code":"IDEMPOTENCY_CONFLICT","message":"private server details"}}"#.utf8)
        XCTAssertEqual(CapsuleDestination.mapError(status: 409, data: body), .idempotencyConflict)
        XCTAssertEqual(CapsuleDestination.mapError(status: 409, data: Data()), .rejected)
        for status in [401, 403] { XCTAssertEqual(CapsuleDestination.mapError(status: status, data: body), .authentication) }
        XCTAssertEqual(CapsuleDestination.mapError(status: 429, data: body), .rateLimited)
        for status in [500, 502, 503] { XCTAssertEqual(CapsuleDestination.mapError(status: status, data: body), .unavailable) }
        XCTAssertFalse(ScanError.rejected.localizedDescription.contains("private"))
    }
    func testDestinationSendsAuthenticatedPOSTAndParsesDuplicate() async throws {
        let credentials = MemoryCredentials()
        let token = UUID().uuidString // ephemeral test value; never a real credential
        await credentials.write(token, for: .capsuleToken)
        let id = UUID().uuidString
        let http = StubHTTP(body: Data("{\"id\":\"\(id)\",\"duplicate\":true}".utf8))
        let destination = CapsuleDestination(credentials: credentials, transport: http)
        let body = try CapsulePayload(fields: ItemFields(name: "shirt"), jpeg: nil).encoded()
        let key = UUID().uuidString
        let result = try await destination.save(body: body, idempotencyKey: key)
        XCTAssertEqual(result, DestinationReceipt(itemID: id, duplicate: true))
        let requests = await http.requests
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://capsule.gtfol.dev/api/v1/wardrobe")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(token)")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), key)
        XCTAssertEqual(request.httpBody, body)
    }
    func testAuthFailureClearsToken() async throws {
        for status in [401, 403] {
            let vault = MemoryCredentials()
            await vault.write(UUID().uuidString, for: .capsuleToken)
            let destination = CapsuleDestination(credentials: vault, transport: StubHTTP(status: status))
            do { _ = try await destination.save(body: Data(), idempotencyKey: UUID().uuidString); XCTFail() }
            catch { XCTAssertEqual(error as? ScanError, .authentication) }
            let token = await vault.read(.capsuleToken)
            XCTAssertNil(token)
        }
    }
    func testTimeoutAndOfflineMapping() async throws {
        for (code, expected) in [(URLError.timedOut, ScanError.timeout), (.notConnectedToInternet, .offline)] {
            let vault = MemoryCredentials(); await vault.write(UUID().uuidString, for: .capsuleToken)
            let destination = CapsuleDestination(credentials: vault, transport: StubHTTP(error: URLError(code)))
            do { _ = try await destination.save(body: Data(), idempotencyKey: UUID().uuidString); XCTFail() }
            catch { XCTAssertEqual(error as? ScanError, expected) }
        }
    }
    func testLLMValidatesCategoryAndUsesNoServerPersistence() async throws {
        let vault = MemoryCredentials(); await vault.write(UUID().uuidString, for: .visionAPIKey)
        let text = "{\"name\":\"shirt\",\"brand\":null,\"category\":\"invented\",\"color\":\"faded blue\"}"
        let response = try JSONSerialization.data(withJSONObject: ["output": [["content": [["type": "output_text", "text": text]]]]])
        let http = StubHTTP(body: response)
        let draft = try await LLMVisionItemExtractor(credentials: vault, transport: http).extract(image: Data([1]))
        XCTAssertNil(draft.category); XCTAssertEqual(draft.color, "faded blue")
        let requests = await http.requests
        let request = try XCTUnwrap(requests.first)
        let json = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as! [String: Any]
        XCTAssertEqual(json["store"] as? Bool, false)
    }
    static func fixtureImage(width: Int, height: Int) throws -> Data {
        let context = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(CGColor(red: 0.1, green: 0.2, blue: 0.8, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, try XCTUnwrap(context.makeImage()), nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return data as Data
    }
}

final class IdempotencyTests: XCTestCase {
    @MainActor private func setup(_ outcomes: [ScriptedDestination.Outcome]) async -> (MemoryItems, MemoryMedia, ScriptedDestination, CapsuleSaveCoordinator) {
        let media = MemoryMedia()
        let reference = await media.write(Data([1, 2, 3]), extension: "jpg")
        let store = MemoryItems(ItemRecord(localImageReference: reference, fields: ItemFields(name: "shirt")))
        let destination = ScriptedDestination(outcomes)
        return (store, media, destination, CapsuleSaveCoordinator(items: store, media: media, payloads: SimplePayloads(), destination: destination))
    }
    @MainActor func testTimeoutRetryAfterCoordinatorRestartKeepsExactKeyAndBody() async throws {
        let (store, media, destination, first) = await setup([.failure(.timeout), .success(false)])
        do { try await first.send(id: store.value.id); XCTFail() } catch {}
        XCTAssertEqual(store.value.capsuleSaveState, .failed)
        let key = try XCTUnwrap(store.value.capsuleIdempotencyKey)
        let restarted = CapsuleSaveCoordinator(items: store, media: media, payloads: SimplePayloads(), destination: destination)
        try await restarted.send(id: store.value.id)
        let requests = await destination.requests
        XCTAssertEqual(requests.count, 2); XCTAssertEqual(requests[0].0, requests[1].0)
        XCTAssertEqual(requests[0].1, key); XCTAssertEqual(requests[1].1, key)
        XCTAssertEqual(store.value.capsuleSaveState, .saved)
        XCTAssertNotNil(store.value.capsuleRemoteItemID)
        XCTAssertEqual(store.commits.first?.capsuleSaveState, .saving)
        XCTAssertNotNil(store.commits.first?.capsuleRequestReference)
    }
    @MainActor func testEditedFailureUsesNewKeyAndNewBody() async throws {
        let (store, _, destination, coordinator) = await setup([.failure(.unavailable), .success(false)])
        do { try await coordinator.send(id: store.value.id) } catch {}
        let firstKey = store.value.capsuleIdempotencyKey
        var edited = store.value; var fields = edited.fields; fields.color = "faded blue"; edited.edit(fields)
        XCTAssertNil(edited.capsuleIdempotencyKey)
        try store.save(edited)
        try await coordinator.send(id: edited.id)
        let requests = await destination.requests
        XCTAssertNotEqual(firstKey, store.value.capsuleIdempotencyKey)
        XCTAssertNotEqual(requests[0].0, requests[1].0)
    }
    @MainActor func testUnchangedFailureRetainsKey() async throws {
        let (store, _, _, coordinator) = await setup([.failure(.offline)])
        do { try await coordinator.send(id: store.value.id) } catch {}
        var record = store.value; record.edit(record.fields)
        XCTAssertEqual(record.capsuleIdempotencyKey, store.value.capsuleIdempotencyKey)
    }
    @MainActor func testConflictRetriesOnlyOnceWithNewKey() async throws {
        let (store, _, destination, coordinator) = await setup([.failure(.idempotencyConflict), .failure(.idempotencyConflict)])
        do { try await coordinator.send(id: store.value.id); XCTFail() } catch { XCTAssertEqual(error as? ScanError, .idempotencyConflict) }
        let requests = await destination.requests
        XCTAssertEqual(requests.count, 2); XCTAssertNotEqual(requests[0].1, requests[1].1)
        XCTAssertEqual(requests[0].0, requests[1].0)
        XCTAssertEqual(store.value.capsuleSaveState, .failed)
    }
    @MainActor func testDuplicateIsSuccessAndCannotSendAgain() async throws {
        let (store, _, destination, coordinator) = await setup([.success(true)])
        try await coordinator.send(id: store.value.id)
        XCTAssertEqual(store.value.capsuleSaveState, .alreadyExists)
        XCTAssertEqual(store.value.capsuleSaveState.label, "already in your wardrobe")
        try await coordinator.send(id: store.value.id)
        let requests = await destination.requests; XCTAssertEqual(requests.count, 1)
    }
    @MainActor func testNoNetworkWriteIfCheckpointCannotPersist() async throws {
        let (store, _, destination, coordinator) = await setup([.success(false)])
        store.rejectWrites = true
        do { try await coordinator.send(id: store.value.id); XCTFail() } catch {}
        let requests = await destination.requests; XCTAssertEqual(requests.count, 0)
    }
}

struct OversizedImage: ImageProcessing {
    func jpeg(_ data: Data, maxEdge: Int, quality: Double) -> ProcessedImage {
        ProcessedImage(data: Data(repeating: 0, count: 1_500_001), width: maxEdge, height: maxEdge)
    }
}

final class MediaTests: XCTestCase {
    func testOversizedPayloadNeverEscapesLimit() async {
        do {
            _ = try await CapsulePayloadBuilder(images: OversizedImage()).prepare(fields: ItemFields(name: "shirt"), image: Data())
            XCTFail("expected an image-size error")
        } catch { XCTAssertEqual(error as? ScanError, .imageTooLarge) }
    }
    func testPortraitPhotoIsLimited() async throws {
        let output = try await ImageProcessor().jpeg(CoreTests.fixtureImage(width: 1800, height: 3200), maxEdge: 4000, quality: 0.85)
        XCTAssertEqual(output.width, 900); XCTAssertEqual(output.height, 1600)
    }
    func testMediaReferenceSurvivesStoreRecreationAndRejectsTraversal() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalMediaStore(directory: directory)
        let bytes = Data([3, 4, 5])
        let reference = try await store.write(bytes, extension: "jpg")
        XCTAssertFalse(reference.contains("/"))
        let reopened = LocalMediaStore(directory: directory)
        let read = try await reopened.read(reference)
        XCTAssertEqual(read, bytes)
        do { _ = try await reopened.read("../" + reference); XCTFail() }
        catch { XCTAssertEqual(error as? ScanError, .storage) }
    }
}

actor CleanupFailureCredentials: CredentialStore {
    private let value = UUID().uuidString
    func read(_ credential: Credential) -> String? { credential == .capsuleToken ? value : nil }
    func write(_ value: String?, for credential: Credential) throws { throw ScanError.keychain }
}
final class AuthenticationTests: XCTestCase {
    func testRejectedTokenStillReportsAuthenticationIfKeychainIsTemporarilyLocked() async {
        let destination = CapsuleDestination(credentials: CleanupFailureCredentials(), transport: StubHTTP(status: 403))
        do { _ = try await destination.save(body: Data(), idempotencyKey: UUID().uuidString); XCTFail() }
        catch { XCTAssertEqual(error as? ScanError, .authentication) }
    }
}
