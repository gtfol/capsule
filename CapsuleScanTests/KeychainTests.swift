#if os(iOS)
import XCTest
@testable import CapsuleScan

final class KeychainTests: XCTestCase {
    func testSystemKeychainPersistsUpdatesAndDeletesAnIsolatedCredential() async throws {
        let service = "dev.gtfol.capsulescan.tests.\(UUID().uuidString)"
        let store = KeychainStore(service: service)
        do {
            let initial = try await store.read(.capsuleSession)
            XCTAssertNil(initial)
            let value = UUID().uuidString
            try await store.write(value, for: .capsuleSession)
            let reopened = KeychainStore(service: service)
            let persisted = try await reopened.read(.capsuleSession)
            XCTAssertEqual(persisted, value)
            let replacement = UUID().uuidString
            try await reopened.write(replacement, for: .capsuleSession)
            let updated = try await store.read(.capsuleSession)
            XCTAssertEqual(updated, replacement)
            try await store.write(nil, for: .capsuleSession)
            let deleted = try await reopened.read(.capsuleSession)
            XCTAssertNil(deleted)
        } catch {
            try? await store.write(nil, for: .capsuleSession)
            throw error
        }
    }
}
#endif
