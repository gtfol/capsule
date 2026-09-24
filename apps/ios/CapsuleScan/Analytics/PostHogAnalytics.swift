import Foundation
import PostHog

@MainActor final class PostHogAnalytics: AnalyticsSink {
    // Public ingestion token, also shipped in Capsule's web JavaScript. Not a personal API key.
    static let projectToken = "phc_BbwoisR4zaJUGqoXZHPfphpdwagKgsrp2pxNTTXyuot2"
    private let sdk = PostHogSDK.shared
    private var started = false
    static func configuration() -> PostHogConfig {
        let config = PostHogConfig(projectToken: projectToken, host: "https://us.i.posthog.com")
        config.captureApplicationLifecycleEvents = false
        config.captureScreenViews = false
        config.captureElementInteractions = false
        config.captureSwiftUIElementInteractions = false
        config.captureAutocaptureElementText = false
        config.capturePushNotificationSubscriptions = false
        config.capturePushNotificationOpened = false
        config.enableSwizzling = false
        config.sessionReplay = false
        config.errorTrackingConfig.autoCapture = false
        config.surveys = false
        config.preloadFeatureFlags = false
        config.setDefaultPersonProperties = false
        config.personProfiles = .identifiedOnly
        config.debug = false
        config.setBeforeSend { event in
            guard let clean = AnalyticsPrivacy.sanitized(event: event.event, properties: event.properties) else { return nil }
            event.properties = clean
            return event
        }
        return config
    }
    func setEnabled(_ enabled: Bool) {
        if enabled {
            if !started { sdk.setup(Self.configuration()); started = true }
            sdk.optIn()
        } else if started { sdk.optOut() }
    }
    func capture(_ event: AnalyticsEvent) { sdk.capture(event.name, properties: event.properties) }
    func identify(_ accountID: String) {
        // Covers a persisted SDK identity from a previous account/session as well.
        if sdk.getDistinctId() != accountID { sdk.reset() }
        sdk.identify(accountID)
    }
    func reset() { if started { sdk.reset() } }

    static func make() -> AppAnalytics {
        #if DEBUG
        return AppAnalytics() // No development/test traffic in the production project.
        #else
        let testing = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil || NSClassFromString("XCTestCase") != nil
        return AppAnalytics(sink: testing ? nil : PostHogAnalytics(), allowed: !testing)
        #endif
    }
}
