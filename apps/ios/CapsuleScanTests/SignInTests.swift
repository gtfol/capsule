import XCTest
import Foundation
#if canImport(CapsuleScan)
@testable import CapsuleScan
#else
@testable import CapsuleScanCore
#endif

final class SignInTests: XCTestCase {
    func testPKCEUsesS256AndNeverPlacesVerifierInAuthorizationURL() throws {
        // RFC 7636 public test vector, not a credential.
        let attempt = CapsuleSignInRequest(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", state: String(repeating: "s", count: 43))
        XCTAssertEqual(attempt.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertFalse(attempt.url.absoluteString.contains(attempt.verifier))
        let first = try CapsuleSignInRequest(), second = try CapsuleSignInRequest()
        XCTAssertEqual(first.verifier.count, 43); XCTAssertEqual(first.state.count, 43)
        XCTAssertNotEqual(first.verifier, second.verifier); XCTAssertNotEqual(first.state, second.state)
    }
    func testCallbackRejectsWrongStateSchemeHostPathAndDuplicateParameters() throws {
        let attempt = try CapsuleSignInRequest()
        let code = try CapsuleSignInRequest().verifier
        let callback = "dev.gtfol.capsulescan://auth/callback?code=\(code)&state=\(attempt.state)"
        XCTAssertEqual(try attempt.code(from: XCTUnwrap(URL(string: callback))), code)
        let invalid = [callback.replacingOccurrences(of: attempt.state, with: "wrong"),
                       callback.replacingOccurrences(of: "dev.gtfol.capsulescan:", with: "https:"),
                       callback.replacingOccurrences(of: "//auth/", with: "//other/"),
                       callback.replacingOccurrences(of: "/callback", with: "/elsewhere"),
                       callback + "&code=\(code)", callback + "&state=\(attempt.state)", callback + "#fragment"]
        for url in invalid { XCTAssertThrowsError(try attempt.code(from: XCTUnwrap(URL(string: url)))) }
    }
    func testExchangeSendsVerifierInPOSTBodyAndStoresSessionAtomically() async throws {
        let attempt = try CapsuleSignInRequest()
        let code = try CapsuleSignInRequest().verifier
        let login = CapsuleLogin(token: "capsule_" + (try CapsuleSignInRequest().verifier), user: CapsuleUser(id: UUID().uuidString, name: "test"))
        let http = StubHTTP(body: try JSONEncoder().encode(login))
        let result = try await CapsuleSignInClient(transport: http).exchange(attempt, callback: XCTUnwrap(URL(string: "dev.gtfol.capsulescan://auth/callback?code=\(code)&state=\(attempt.state)")))
        XCTAssertEqual(result, login)
        let requests = await http.requests
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://capsule.gtfol.dev/api/scan/exchange")
        let body = try JSONDecoder().decode([String:String].self, from: XCTUnwrap(request.httpBody))
        XCTAssertEqual(body, ["code":code,"code_verifier":attempt.verifier])
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        let vault = MemoryCredentials()
        try await vault.storeCapsuleLogin(result)
        let persisted = try await vault.capsuleLogin(); XCTAssertEqual(persisted, login)
        let values = await vault.values; XCTAssertEqual(values.count, 1)
    }
    func testReplacingLoginPreventsOldRequestFromClearingNewCredential() async throws {
        let vault = MemoryCredentials()
        let first = CapsuleLogin(token: UUID().uuidString, user: CapsuleUser(id: "first", name: "test"))
        let second = CapsuleLogin(token: UUID().uuidString, user: CapsuleUser(id: "second", name: "test"))
        try await vault.storeCapsuleLogin(first)
        try await vault.storeCapsuleLogin(second)
        try await vault.clearCapsuleLogin(matching: first.token)
        let kept = try await vault.capsuleLogin(); XCTAssertEqual(kept, second)
        try await vault.clearCapsuleLogin(matching: second.token)
        let cleared = try await vault.capsuleLogin(); XCTAssertNil(cleared)
    }
}

extension SignInTests {
    func testAccountBoundDestinationRejectsCredentialFromAnotherAccount() async throws {
        let vault = MemoryCredentials()
        try await vault.storeCapsuleLogin(CapsuleLogin(token: UUID().uuidString, user: CapsuleUser(id: "other", name: "test")))
        let http = StubHTTP()
        let destination = CapsuleDestination(credentials: vault, transport: http, expectedUserID: "owner")
        do { _ = try await destination.save(body: Data(), idempotencyKey: UUID().uuidString); XCTFail() }
        catch { XCTAssertEqual(error as? ScanError, .wrongAccount) }
        let requests = await http.requests; XCTAssertTrue(requests.isEmpty)
    }
}
