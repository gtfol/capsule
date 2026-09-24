import SwiftUI
import SwiftData

@MainActor final class AppServices: ObservableObject {
    let container: ModelContainer
    let items: SwiftDataItemStore
    let media: any MediaStoring
    let images: any ImageProcessing
    let isolation: any ImageIsolating
    let credentials: any CredentialStore
    let transport: any HTTPTransport
    private var activeSaves: Set<UUID> = []
    private let browser: any BrowserAuthenticating
    private let extractionOverride: (any ItemExtractor)?
    private var authenticationRejected = false
    @Published var wardrobeReloadID = UUID()
    @Published private(set) var user: CapsuleUser?
    @Published private(set) var credentialsReady = false
    @Published private(set) var authenticating = false
    @Published private(set) var visionEnabled = false
    @Published private(set) var hasVisionKey = false
    @Published var connectionMessage: String?
    @Published private(set) var wishlistEnabled = false
    var wishlist: (any WardrobeServing)? {
        guard let user, connected, wishlistEnabled else { return nil }
        return CapsuleWardrobeClient(credentials: credentials, transport: transport, expectedUserID: user.id, collection: .wishlist)
    }
    var wardrobe: (any WardrobeServing)? {
        guard let user, connected else { return nil }
        return CapsuleWardrobeClient(credentials: credentials, transport: transport, expectedUserID: user.id)
    }
    var connected: Bool { user != nil && !authenticationRejected }

    init(container: ModelContainer, media: any MediaStoring, images: any ImageProcessing = ImageProcessor(),
         credentials: any CredentialStore = KeychainStore(), transport: any HTTPTransport = HTTPClient(),
         extractor: (any ItemExtractor)? = nil, browser: any BrowserAuthenticating = BrowserSignIn(),
         isolation: any ImageIsolating = VisionImageIsolator()) {
        self.isolation = isolation
        self.extractionOverride = extractor; self.browser = browser
        self.container = container; self.media = media; self.images = images; self.credentials = credentials; self.transport = transport
        items = SwiftDataItemStore(context: container.mainContext)
    }
    func refreshCredentials() async {
        guard !authenticating else { return }
        defer { credentialsReady = true }
        do {
            var login = try await credentials.capsuleLogin()
            if login == nil, !authenticationRejected, let legacy = try await credentials.read(.capsuleToken), !legacy.isEmpty {
                // Resolve the account before a manually connected installation can send again.
                let account = try await CapsuleSignInClient(transport: transport).user(token: legacy)
                login = CapsuleLogin(token: legacy, user: account)
                try await credentials.storeCapsuleLogin(login!)
                try await credentials.write(nil, for: .capsuleToken)
            }
            user = authenticationRejected ? nil : login?.user
            wishlistEnabled = login?.scopes?.contains("wishlist:write") == true && login?.scopes?.contains("wishlist:delete") == true
            hasVisionKey = !(try await credentials.read(.visionAPIKey) ?? "").isEmpty
            let visionConsent = try await credentials.read(.visionPhotoConsent)
            visionEnabled = hasVisionKey && visionConsent == "openai-photos-v1"
        } catch {
            user = nil
            visionEnabled = false; hasVisionKey = false
            connectionMessage = "sign in to capsule to continue."
        }
    }
    func signIn() async {
        guard !authenticating else { return }
        authenticating = true; connectionMessage = nil
        defer { authenticating = false; credentialsReady = true }
        do {
            let attempt = try CapsuleSignInRequest()
            let callback = try await browser.authenticate(url: attempt.url, callbackScheme: CapsuleSignInRequest.callbackScheme)
            let login = try await CapsuleSignInClient(transport: transport).exchange(attempt, callback: callback)
            try await credentials.storeCapsuleLogin(login) // Token and account commit atomically in Keychain.
            try? await credentials.write(nil, for: .capsuleToken)
            authenticationRejected = false; user = login.user
            wishlistEnabled = login.scopes?.contains("wishlist:write") == true && login.scopes?.contains("wishlist:delete") == true
            wardrobeReloadID = UUID()
        } catch SignInError.cancelled { }
        catch { connectionMessage = (error as? SignInError)?.localizedDescription ?? ScanError.keychain.localizedDescription }
    }
    func signOut() async {
        guard !authenticating else { return }
        authenticating = true; connectionMessage = nil
        defer { authenticating = false }
        do {
            if let token = try await credentials.capsuleBearerToken() {
                // Require the remote revocation before reporting a complete sign-out.
                try await CapsuleSignInClient(transport: transport).revoke(token: token)
                try await credentials.clearCapsuleLogin(matching: token)
            }
            authenticationRejected = false; user = nil
            await WardrobePhotoCache.shared.clear()
        } catch { connectionMessage = "couldn’t sign out. check your connection and try again." }
    }
    // Call only after the user explicitly agrees to send garment photos to OpenAI.
    // Consent is cleared first so a partial write always leaves extraction on device.
    func enableVision(key: String?) async throws {
        visionEnabled = false
        try await credentials.write(nil, for: .visionPhotoConsent)
        if let key {
            let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw ScanError.keychain }
            try await credentials.write(trimmed, for: .visionAPIKey)
        }
        guard !(try await credentials.read(.visionAPIKey) ?? "").isEmpty else { throw ScanError.keychain }
        try await credentials.write("openai-photos-v1", for: .visionPhotoConsent)
        await refreshCredentials()
    }
    func removeVisionKey() async throws {
        visionEnabled = false
        try await credentials.write(nil, for: .visionPhotoConsent)
        try await credentials.write(nil, for: .visionAPIKey)
        await refreshCredentials()
    }
    func extractor() -> any ItemExtractor {
        if let extractionOverride { return extractionOverride }
        return visionEnabled ? LLMVisionItemExtractor(credentials: credentials, transport: transport) as any ItemExtractor : OnDeviceItemExtractor()
    }
    func send(id: UUID) async throws {
        guard !activeSaves.contains(id) else { return }
        guard connected, let user else { throw ScanError.notConnected }
        let item = try items.record(id: id)
        guard item.capsuleUserID == user.id else { throw ScanError.wrongAccount }
        activeSaves.insert(id)
        defer { activeSaves.remove(id) }
        let saves = CapsuleSaveCoordinator(items: items, media: media, payloads: CapsulePayloadBuilder(images: images),
                                          destination: CapsuleDestination(credentials: credentials, transport: transport, expectedUserID: user.id))
        do {
            try await saves.send(id: id)
            let completed = try items.record(id: id)
            if completed.capsuleSaveState.completed {
                wardrobeReloadID = UUID()
                // Keep a small success receipt to prevent resubmission, not a second wardrobe.
                await media.remove(completed.localImageReference)
                if let request = completed.capsuleRequestReference { await media.remove(request) }
            }
        } catch {
            if error as? ScanError == .authentication || error as? ScanError == .notConnected {
                authenticationRejected = true; self.user = nil
                connectionMessage = ScanError.authentication.localizedDescription
            }
            throw error
        }
    }
}
