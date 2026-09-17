import Foundation
import CryptoKit
import Security

struct CapsuleUser: Codable, Equatable, Sendable { let id: String; let name: String }
struct CapsuleLogin: Codable, Equatable, Sendable { let token: String; let user: CapsuleUser }
enum SignInError: Error, LocalizedError, Sendable {
    case cancelled, invalidCallback, unavailable, tokenLimit
    var errorDescription: String? {
        switch self {
        case .cancelled: "sign-in cancelled."
        case .invalidCallback: "couldn’t finish signing in. try again."
        case .unavailable: "couldn’t connect to capsule. try again."
        case .tokenLimit: "remove an unused connection in capsule settings, then try again."
        }
    }
}
struct CapsuleSignInRequest: Sendable {
    static let callbackScheme = "dev.gtfol.capsulescan"
    let verifier: String
    let state: String
    init() throws { verifier = try Self.randomValue(); state = try Self.randomValue() }
    // Deterministic input for protocol regression tests.
    init(verifier: String, state: String) { self.verifier = verifier; self.state = state }
    var challenge: String { Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    var url: URL {
        var url = URLComponents(string: "https://capsule.gtfol.dev/scan/connect")!
        url.queryItems = [URLQueryItem(name: "code_challenge", value: challenge), URLQueryItem(name: "state", value: state)]
        return url.url!
    }
    func code(from callback: URL) throws -> String {
        guard let url = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              url.scheme == Self.callbackScheme, url.host == "auth", url.path == "/callback",
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let items = url.queryItems, items.count == 2,
              items.filter({ $0.name == "state" }).count == 1,
              items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value,
              code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw SignInError.invalidCallback }
        return code
    }
    private static func randomValue() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw SignInError.unavailable }
        return base64url(Data(bytes))
    }
    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
struct CapsuleSignInClient: Sendable {
    let transport: any HTTPTransport
    func exchange(_ attempt: CapsuleSignInRequest, callback: URL) async throws -> CapsuleLogin {
        let code = try attempt.code(from: callback)
        var request = URLRequest(url: URL(string: "https://capsule.gtfol.dev/api/scan/exchange")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code, "code_verifier": attempt.verifier])
        let result: HTTPResult
        do { result = try await transport.send(request) } catch { throw SignInError.unavailable }
        guard result.status == 200 else { throw result.status == 409 ? SignInError.tokenLimit : SignInError.invalidCallback }
        guard let login = try? JSONDecoder().decode(CapsuleLogin.self, from: result.data),
              login.token.range(of: "^capsule_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              !login.user.id.isEmpty, login.user.id.count <= 256, login.user.name.count <= 1000 else { throw SignInError.invalidCallback }
        return login
    }
    func user(token: String) async throws -> CapsuleUser {
        let result = try await transport.send(sessionRequest(token: token, method: "GET"))
        guard result.status == 200 else { throw CapsuleDestination.mapError(status: result.status, data: result.data) }
        struct Response: Decodable { let user: CapsuleUser }
        guard let result = try? JSONDecoder().decode(Response.self, from: result.data), !result.user.id.isEmpty else { throw ScanError.invalidResponse }
        return result.user
    }
    func revoke(token: String) async throws {
        let result = try await transport.send(sessionRequest(token: token, method: "DELETE"))
        guard result.status == 200 || result.status == 401 else { throw SignInError.unavailable }
    }
    private func sessionRequest(token: String, method: String) -> URLRequest {
        var request = URLRequest(url: URL(string: "https://capsule.gtfol.dev/api/scan/session")!)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }
}
extension CredentialStore {
    func capsuleLogin() async throws -> CapsuleLogin? {
        guard let value = try await read(.capsuleSession), let data = value.data(using: .utf8) else { return nil }
        return try JSONDecoder().decode(CapsuleLogin.self, from: data)
    }
    func storeCapsuleLogin(_ login: CapsuleLogin) async throws {
        try await write(String(decoding: JSONEncoder().encode(login), as: UTF8.self), for: .capsuleSession)
    }
    func capsuleBearerToken() async throws -> String? {
        if let login = try await capsuleLogin() { return login.token }
        return try await read(.capsuleToken) // Migrate an existing manual connection on launch.
    }
    func clearCapsuleLogin(matching token: String) async throws {
        if let login = try await capsuleLogin(), login.token == token { try await write(nil, for: .capsuleSession) }
        if try await read(.capsuleToken) == token { try await write(nil, for: .capsuleToken) }
    }
}
