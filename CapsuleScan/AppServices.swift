import SwiftUI
import SwiftData

@MainActor final class AppServices: ObservableObject {
    let container: ModelContainer
    let items: SwiftDataItemStore
    let media: any MediaStoring
    let images: any ImageProcessing
    let credentials: any CredentialStore
    let transport: any HTTPTransport
    let saves: CapsuleSaveCoordinator
    private let extractionOverride: (any ItemExtractor)?
    private var authenticationRejected = false
    @Published private(set) var connected = false
    @Published private(set) var visionEnabled = false
    @Published var connectionMessage: String?

    init(container: ModelContainer, media: any MediaStoring, images: any ImageProcessing = ImageProcessor(),
         credentials: any CredentialStore = KeychainStore(), transport: any HTTPTransport = HTTPClient(), extractor: (any ItemExtractor)? = nil) {
        self.extractionOverride = extractor
        self.container = container; self.media = media; self.images = images; self.credentials = credentials; self.transport = transport
        items = SwiftDataItemStore(context: container.mainContext)
        saves = CapsuleSaveCoordinator(items: items, media: media, payloads: CapsulePayloadBuilder(images: images), destination: CapsuleDestination(credentials: credentials, transport: transport))
    }
    func refreshCredentials() async {
        do {
            let tokenExists = !(try await credentials.read(.capsuleToken) ?? "").isEmpty
            connected = tokenExists && !authenticationRejected
            visionEnabled = !(try await credentials.read(.visionAPIKey) ?? "").isEmpty
        } catch { connected = false; visionEnabled = false; connectionMessage = ScanError.keychain.localizedDescription }
    }
    func setCredential(_ value: String?, for kind: Credential) async throws {
        try await credentials.write(value?.trimmingCharacters(in: .whitespacesAndNewlines), for: kind)
        if kind == .capsuleToken { authenticationRejected = false; connectionMessage = nil }
        await refreshCredentials()
    }
    func extractor() -> any ItemExtractor {
        if let extractionOverride { return extractionOverride }
        return visionEnabled ? LLMVisionItemExtractor(credentials: credentials, transport: transport) as any ItemExtractor : OnDeviceItemExtractor()
    }
    func send(id: UUID) async throws {
        do { try await saves.send(id: id) }
        catch {
            if error as? ScanError == .authentication || error as? ScanError == .notConnected {
                authenticationRejected = true
                connected = false
                connectionMessage = ScanError.authentication.localizedDescription
            }
            throw error
        }
    }
}
