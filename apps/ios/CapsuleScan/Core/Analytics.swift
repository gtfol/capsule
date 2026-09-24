import Foundation

enum AnalyticsScreen: String, CaseIterable { case wardrobe, wishlist, outfits, capture, settings, drafts }
enum AnalyticsSource: String { case camera, library }
enum AnalyticsEvent {
    case appOpened, signedIn, signedOut
    case screen(AnalyticsScreen), photoSelected(AnalyticsSource)
    case pieceSaved(CapsuleCollection, created: Bool, duplicate: Bool?)
    case pieceRemoved(CapsuleCollection), wishlistPromoted
    case backgroundRemoved, modelPhotoSet, modelPhotoRemoved
    case renderStarted(Int), renderCompleted, renderFailed

    var name: String {
        switch self {
        case .appOpened: "app_opened"
        case .signedIn: "account_signed_in"
        case .signedOut: "account_signed_out"
        case .screen: "$screen"
        case .photoSelected: "garment_photo_selected"
        case .pieceSaved(_, let created, _): created ? "piece_added" : "piece_updated"
        case .pieceRemoved: "piece_removed"
        case .wishlistPromoted: "wishlist_piece_promoted"
        case .backgroundRemoved: "background_removed"
        case .modelPhotoSet: "model_photo_set"
        case .modelPhotoRemoved: "model_photo_removed"
        case .renderStarted: "outfit_render_started"
        case .renderCompleted: "outfit_render_completed"
        case .renderFailed: "outfit_render_failed"
        }
    }
    var properties: [String: Any] {
        switch self {
        case .screen(let screen): ["$screen_name": screen.rawValue]
        case .photoSelected(let source): ["source": source.rawValue]
        case .pieceSaved(let collection, _, let duplicate):
            ["collection": collection.rawValue, "duplicate": duplicate as Any?].compactMapValues { $0 }
        case .pieceRemoved(let collection): ["collection": collection.rawValue]
        case .renderStarted(let count): ["piece_count": max(0, min(count, 6))]
        default: [:]
        }
    }
}

// Final boundary, including properties the SDK adds. No arbitrary text, URLs,
// item identifiers, nested objects, photos, or error descriptions cross it.
enum AnalyticsPrivacy {
    static let names: Set<String> = ["app_opened", "account_signed_in", "account_signed_out", "$screen", "$identify", "garment_photo_selected", "piece_added", "piece_updated", "piece_removed", "wishlist_piece_promoted", "background_removed", "model_photo_set", "model_photo_removed", "outfit_render_started", "outfit_render_completed", "outfit_render_failed"]
    static func sanitized(event: String, properties: [String: Any]) -> [String: Any]? {
        guard names.contains(event) else { return nil }
        var clean: [String: Any] = ["platform": "ios", "$geoip_disable": true]
        let metadata: Set<String> = ["$app_version", "$app_build", "$os_name", "$os_version", "$device_model", "$lib", "$lib_version"]
        for (key, value) in properties {
            if metadata.contains(key), let text = value as? String, text.count <= 80,
               text.range(of: "^[A-Za-z0-9 ._(),-]+$", options: .regularExpression) != nil { clean[key] = text }
            if ["$is_testflight", "$is_identified", "$process_person_profile"].contains(key), let flag = value as? Bool { clean[key] = flag }
            if ["$session_id", "$anon_distinct_id"].contains(key), let id = value as? String, UUID(uuidString: id) != nil { clean[key] = id }
        }
        if event == "$screen", let screen = properties["$screen_name"] as? String, AnalyticsScreen(rawValue: screen) != nil { clean["$screen_name"] = screen }
        if event == "garment_photo_selected", let source = properties["source"] as? String, AnalyticsSource(rawValue: source) != nil { clean["source"] = source }
        if ["piece_added", "piece_updated", "piece_removed"].contains(event), let collection = properties["collection"] as? String, ["wardrobe", "wishlist"].contains(collection) { clean["collection"] = collection }
        if ["piece_added", "piece_updated"].contains(event), let flag = properties["duplicate"] as? Bool { clean["duplicate"] = flag }
        if event == "outfit_render_started", let count = properties["piece_count"] as? Int, (0...6).contains(count) { clean["piece_count"] = count }
        return clean
    }
}

@MainActor protocol AnalyticsSink: AnyObject {
    func setEnabled(_ enabled: Bool)
    func capture(_ event: AnalyticsEvent)
    func identify(_ accountID: String)
    func reset()
}
@MainActor final class AppAnalytics {
    static let preference = "capsule.usage-analytics"
    private let sink: (any AnalyticsSink)?
    private let defaults: UserDefaults
    private let allowed: Bool
    private var accountID: String?
    private var accountResolved = false
    private(set) var enabled: Bool
    init(sink: (any AnalyticsSink)? = nil, defaults: UserDefaults = .standard, allowed: Bool = false) {
        self.sink = sink; self.defaults = defaults; self.allowed = allowed
        enabled = defaults.object(forKey: Self.preference) as? Bool ?? true
        sink?.setEnabled(allowed && enabled)
    }
    func setEnabled(_ value: Bool) {
        guard enabled != value else { return }
        enabled = value; defaults.set(value, forKey: Self.preference)
        sink?.setEnabled(allowed && value)
        if allowed && value, let accountID { sink?.identify(accountID) }
    }
    func account(_ id: String?) {
        guard !accountResolved || id != accountID else { return }
        // Account switching must never join two people's activity.
        if (accountID != nil || !accountResolved && id == nil), allowed { sink?.reset() }
        accountID = id; accountResolved = true
        if allowed && enabled, let id { sink?.identify(id) }
    }
    func track(_ event: AnalyticsEvent) {
        guard allowed && enabled && accountResolved else { return }
        sink?.capture(event)
    }
}
