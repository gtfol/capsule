import Foundation
import Security

enum Credential: String, Sendable { case capsuleToken, capsuleSession, visionAPIKey }
protocol CredentialStore: Sendable {
    func read(_ credential: Credential) async throws -> String?
    func write(_ value: String?, for credential: Credential) async throws
}

actor KeychainStore: CredentialStore {
    private let service = "dev.gtfol.capsulescan.credentials"
    func read(_ credential: Credential) throws -> String? {
        var query = base(credential)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else { throw ScanError.keychain }
        return value
    }
    func write(_ value: String?, for credential: Credential) throws {
        let query = base(credential)
        guard let value, !value.isEmpty else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw ScanError.keychain }
            return
        }
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw ScanError.keychain }
    }
    private func base(_ credential: Credential) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: credential.rawValue, kSecAttrSynchronizable as String: false]
    }
}
