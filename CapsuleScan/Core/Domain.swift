import Foundation

enum GarmentCategory: String, Codable, CaseIterable, Sendable, Identifiable {
    case tops, jackets, bottoms, accessories, shoes
    var id: String { rawValue }
    static func validated(_ value: String?) -> Self? {
        guard let value else { return nil }
        return Self(rawValue: value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }
}

enum CapsuleSaveState: String, Codable, Sendable {
    case notSaved, saving, saved, alreadyExists, failed
    var label: String {
        switch self {
        case .notSaved: return "local only"
        case .saving: return "saving to capsule…"
        case .saved: return "saved to capsule"
        case .alreadyExists: return "already in your wardrobe"
        case .failed: return "not sent · retry"
        }
    }
    var completed: Bool { self == .saved || self == .alreadyExists }
}

struct ItemFields: Codable, Equatable, Sendable {
    var name = ""
    var brand = ""
    var category: GarmentCategory?
    var color = ""
    var size = ""
    // Canonical decimal string, never a binary floating-point value.
    var price: String?
    var currency = Locale.current.currency?.identifier ?? "USD"

    func validated(requireName: Bool = false) throws -> Self {
        var copy = self
        copy.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.brand = brand.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.color = color.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.size = size.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.currency = currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if requireName && copy.name.isEmpty { throw ScanError.nameRequired }
        guard copy.name.count <= 300, copy.brand.count <= 200, copy.color.count <= 100, copy.size.count <= 100 else {
            throw ScanError.invalidFields
        }
        if !copy.currency.isEmpty && copy.currency.range(of: "^[A-Z]{3}$", options: .regularExpression) == nil {
            throw ScanError.invalidCurrency
        }
        copy.price = try Price.canonical(price ?? "", locale: Locale(identifier: "en_US_POSIX"))
        return copy
    }
}

enum Price {
    static func canonical(_ text: String, locale: Locale = .current) throws -> String? {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return nil }
        let separator = locale.decimalSeparator ?? "."
        if separator != "." { value = value.replacingOccurrences(of: separator, with: ".") }
        guard value.range(of: "^[0-9]{1,12}(\\.[0-9]{1,6})?$", options: .regularExpression) != nil,
              let decimal = Decimal(string: value, locale: Locale(identifier: "en_US_POSIX")), decimal >= 0 else {
            throw ScanError.invalidPrice
        }
        return NSDecimalNumber(decimal: decimal).stringValue
    }
    static func display(_ value: String?, locale: Locale = .current) -> String {
        (value ?? "").replacingOccurrences(of: ".", with: locale.decimalSeparator ?? ".")
    }
}

struct ItemRecord: Codable, Equatable, Sendable, Identifiable {
    var id = UUID()
    var createdAt = Date()
    var updatedAt = Date()
    var localImageReference: String
    var fields = ItemFields()
    var capsuleSaveState: CapsuleSaveState = .notSaved
    var capsuleIdempotencyKey: String?
    var capsuleRemoteItemID: String?
    var lastCapsuleError: String?
    // Exact encoded body on disk: retries never depend on re-encoding an image.
    var capsuleRequestReference: String?

    mutating func edit(_ fields: ItemFields) {
        guard self.fields != fields else { return }
        self.fields = fields
        updatedAt = Date()
        if capsuleSaveState == .failed {
            capsuleIdempotencyKey = nil
            capsuleRequestReference = nil
            capsuleSaveState = .notSaved
            lastCapsuleError = nil
        }
    }
}

enum ScanError: Error, Equatable, LocalizedError, Sendable {
    case nameRequired, invalidFields, invalidPrice, invalidCurrency, invalidImage, imageTooLarge
    case notConnected, authentication, offline, timeout, rateLimited, unavailable, idempotencyConflict
    case rejected, invalidResponse, storage, keychain, extraction
    var errorDescription: String? {
        switch self {
        case .nameRequired: return "add a name before saving to capsule."
        case .invalidFields: return "shorten the item details and try again."
        case .invalidPrice: return "enter a valid price without a currency symbol."
        case .invalidCurrency: return "use a three-letter currency code, like usd."
        case .invalidImage: return "this photo couldn’t be opened. choose another."
        case .imageTooLarge: return "this photo is too large to send. choose a smaller photo."
        case .notConnected: return "connect capsule in settings to send this item."
        case .authentication: return "re-enter your capsule token in settings. your item is saved on this iphone."
        case .offline: return "you’re offline. your item is saved on this iphone. retry when connected."
        case .timeout: return "capsule took too long to reply. retry to check this save."
        case .rateLimited: return "too many saves. wait a few minutes, then retry."
        case .unavailable: return "capsule is unavailable. your item is saved on this iphone. try again."
        case .idempotencyConflict: return "capsule couldn’t confirm this save. try again."
        case .rejected: return "capsule couldn’t accept this item. review the details and retry."
        case .invalidResponse: return "capsule’s reply couldn’t be read. retry to confirm the save."
        case .storage: return "couldn’t save on this iphone. check available storage and try again."
        case .keychain: return "couldn’t access secure storage. unlock your iphone and try again."
        case .extraction: return "couldn’t read the details. enter them below."
        }
    }
    static func transport(_ error: Error) -> Self {
        guard let urlError = error as? URLError else { return .unavailable }
        switch urlError.code {
        case .timedOut: return .timeout
        case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .dataNotAllowed: return .offline
        default: return .unavailable
        }
    }
}
