import XCTest
import Foundation
#if canImport(CapsuleScan)
@testable import CapsuleScan
#else
@testable import CapsuleScanCore
#endif

@MainActor private final class AnalyticsRecorder: AnalyticsSink {
    var calls: [String] = []
    func setEnabled(_ enabled: Bool) { calls.append("enabled:\(enabled)") }
    func capture(_ event: AnalyticsEvent) { calls.append(event.name) }
    func identify(_ accountID: String) { calls.append("identify:\(accountID)") }
    func reset() { calls.append("reset") }
}
final class AnalyticsTests: XCTestCase {
    func testSensitiveAndUnknownPropertiesNeverLeaveBoundary() throws {
        let privateValue = "https://private.invalid/share/secret?token=secret"
        let input: [String: Any] = ["collection": "wardrobe", "duplicate": false, "name": privateValue,
            "imageData": "data:image/jpeg;base64,secret", "token": "secret", "item_id": "secret",
            "$set": ["email": "private@example.test"], "$set_once": ["$initial_current_url": privateValue],
            "$current_url": privateValue, "$screen_name": privateValue, "$device_name": "someone's iphone",
            "$app_version": "1.2", "$app_build": 17, "$geoip_disable": false]
        let clean = try XCTUnwrap(AnalyticsPrivacy.sanitized(event: "piece_added", properties: input))
        XCTAssertEqual(Set(clean.keys), ["collection", "duplicate", "$app_version", "$app_build", "platform", "$geoip_disable"])
        XCTAssertEqual(clean["$geoip_disable"] as? Bool, true)
        XCTAssertFalse(String(describing: clean).contains("secret"))
        XCTAssertNil(AnalyticsPrivacy.sanitized(event: "$snapshot", properties: input))
        XCTAssertNil(AnalyticsPrivacy.sanitized(event: "$autocapture", properties: input))
        XCTAssertNil(AnalyticsPrivacy.sanitized(event: "$exception", properties: input))
        XCTAssertNil(AnalyticsPrivacy.sanitized(event: "future_event", properties: input))
    }
    func testSchemaRejectsArbitraryValuesAndBoundsCounts() throws {
        XCTAssertNil(AnalyticsPrivacy.sanitized(event: "$screen", properties: ["$screen_name": "private item name"])!["$screen_name"])
        XCTAssertNil(AnalyticsPrivacy.sanitized(event: "piece_added", properties: ["collection": "private list"])!["collection"])
        XCTAssertNil(AnalyticsPrivacy.sanitized(event: "outfit_render_started", properties: ["piece_count": 7])!["piece_count"])
        XCTAssertEqual(AnalyticsEvent.renderStarted(100).properties["piece_count"] as? Int, 6)
        XCTAssertEqual(AnalyticsPrivacy.sanitized(event: "$screen", properties: AnalyticsEvent.screen(.settings).properties)?["$screen_name"] as? String, "settings")
        XCTAssertEqual(AnalyticsPrivacy.sanitized(event: "garment_photo_selected", properties: AnalyticsEvent.photoSelected(.camera).properties)?["source"] as? String, "camera")
    }
    @MainActor func testOptOutPersistsAndDoesNotCaptureOrIdentify() {
        let name = "analytics-test-\(UUID())", defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let sink = AnalyticsRecorder(), analytics = AppAnalytics(sink: sink, defaults: defaults, allowed: true)
        analytics.account("first")
        analytics.track(.pieceSaved(.wardrobe, created: true, duplicate: false))
        analytics.setEnabled(false)
        let count = sink.calls.count
        analytics.track(.modelPhotoSet)
        analytics.account("second")
        XCTAssertEqual(Array(sink.calls.dropFirst(count)), ["reset"])
        let restartedSink = AnalyticsRecorder(), restarted = AppAnalytics(sink: restartedSink, defaults: defaults, allowed: true)
        restarted.account("second"); restarted.track(.appOpened)
        XCTAssertEqual(restartedSink.calls, ["enabled:false"])
        restarted.setEnabled(true); restarted.track(.appOpened)
        XCTAssertEqual(Array(restartedSink.calls.suffix(3)), ["enabled:true", "identify:second", "app_opened"])
    }
    @MainActor func testIdentityResetsOnSignOutAndAccountSwitch() {
        let name = "analytics-test-\(UUID())", defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let sink = AnalyticsRecorder(), analytics = AppAnalytics(sink: sink, defaults: defaults, allowed: true)
        analytics.account("first"); analytics.account("first"); analytics.account("second"); analytics.account(nil)
        XCTAssertEqual(sink.calls, ["enabled:true", "identify:first", "reset", "identify:second", "reset"])
    }
    @MainActor func testDevelopmentGateBlocksAllTrafficEvenIfPreferenceEnabled() {
        let sink = AnalyticsRecorder(), analytics = AppAnalytics(sink: sink, allowed: false)
        analytics.account("account"); analytics.track(.appOpened); analytics.account(nil)
        XCTAssertEqual(sink.calls, ["enabled:false"])
    }
}

#if canImport(CapsuleScan)
@MainActor final class PostHogConfigurationTests: XCTestCase {
    func testFailedMutationDoesNotCountAsSuccess() async {
        let name = "analytics-test-\(UUID())", defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let sink = AnalyticsRecorder(), analytics = AppAnalytics(sink: sink, defaults: defaults, allowed: true)
        analytics.account("owner")
        let item = wardrobeFixture(), client = LibraryStub(wardrobeFixture())
        let model = WardrobeDetailModel(item: item, client: client, images: ImageProcessor(), isolation: StubIsolator(output: Data()), analytics: analytics)
        model.edit.fields.name = "this private item name must not be sent"
        let failed = await model.save()
        XCTAssertFalse(failed); XCTAssertFalse(sink.calls.contains("piece_updated"))
        await client.succeed()
        let saved = await model.save()
        XCTAssertTrue(saved); XCTAssertEqual(sink.calls.filter { $0 == "piece_updated" }.count, 1)
        let removed = await model.remove()
        XCTAssertFalse(removed); XCTAssertFalse(sink.calls.contains("piece_removed"))
    }
    func testSDKAutomaticCaptureIsDisabled() {
        let config = PostHogAnalytics.configuration()
        XCTAssertFalse(config.captureApplicationLifecycleEvents)
        XCTAssertFalse(config.captureScreenViews)
        XCTAssertFalse(config.captureElementInteractions)
        XCTAssertFalse(config.captureSwiftUIElementInteractions)
        XCTAssertFalse(config.captureAutocaptureElementText)
        XCTAssertFalse(config.capturePushNotificationSubscriptions)
        XCTAssertFalse(config.capturePushNotificationOpened)
        XCTAssertFalse(config.enableSwizzling)
        XCTAssertFalse(config.sessionReplay)
        XCTAssertFalse(config.errorTrackingConfig.autoCapture)
        XCTAssertFalse(config.surveys)
        XCTAssertFalse(config.preloadFeatureFlags)
        XCTAssertFalse(config.setDefaultPersonProperties)
        XCTAssertFalse(config.debug)
    }
}
#endif
