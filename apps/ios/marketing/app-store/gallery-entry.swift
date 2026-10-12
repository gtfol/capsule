import SwiftUI
import SwiftData

// Screenshot-only entry point in a disposable build. Never shipped or used for App Review access.
actor GalleryCredentials: CredentialStore {
    private var values: [Credential: String] = [:]
    func read(_ credential: Credential) -> String? { values[credential] }
    func write(_ value: String?, for credential: Credential) { values[credential] = value }
}
struct GalleryTransport: HTTPTransport {
    func send(_ request: URLRequest) async throws -> HTTPResult { throw URLError(.notConnectedToInternet) }
}
@main @MainActor struct CapsuleScanApp: App {
    @State private var services: AppServices?
    @State private var editor: ItemEditorModel?
    private let mode = ProcessInfo.processInfo.environment["GALLERY_SCREEN"] ?? "knit"
    var body: some Scene {
        WindowGroup {
            Group {
                if let services, let editor {
                    NavigationStack {
                        if mode == "drafts" { DraftsView() }
                        else { ItemEditorView(model: editor) }
                    }.environmentObject(services).modelContainer(services.container)
                } else { ProgressView().task { await prepare() } }
            }.preferredColorScheme(.dark).font(CapsuleStyle.body).tint(CapsuleStyle.text)
        }
    }
    private func prepare() async {
        do {
            let container = try ModelContainer(for: WardrobeItem.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
            let credentials = GalleryCredentials()
            try await credentials.storeCapsuleLogin(CapsuleLogin(token: UUID().uuidString, user: CapsuleUser(id: "gallery-example", name: "")))
            let media = LocalMediaStore(directory: URL.applicationSupportDirectory.appendingPathComponent("gallery-only"))
            let app = AppServices(container: container, media: media, credentials: credentials, transport: GalleryTransport())
            await app.refreshCredentials()
            let fixtures: [(String, ItemFields)] = [
                ("knit", ItemFields(name: "crewneck knit", brand: "", category: .tops, color: "charcoal", size: "M", currency: "USD")),
                ("jeans", ItemFields(name: "wide-leg jeans", brand: "", category: .bottoms, color: "faded black", size: "S", currency: "USD")),
                ("tee", ItemFields(name: "cotton tee", brand: "", category: .tops, color: "off-white", size: "L", currency: "USD")),
                ("scarf", ItemFields(name: "wool scarf", brand: "", category: .accessories, color: "charcoal", size: "one size", currency: "USD"))
            ]
            for (index, fixture) in fixtures.enumerated() {
                let data = try Data(contentsOf: Bundle.main.url(forResource: fixture.0, withExtension: "png")!)
                let jpeg = try await app.images.jpeg(data, maxEdge: 1600, quality: 0.9).data
                let reference = try await media.write(jpeg, extension: "jpg")
                var record = ItemRecord(localImageReference: reference, fields: fixture.1)
                record.createdAt = Date().addingTimeInterval(Double(-index))
                try app.items.save(record)
                if fixture.0 == mode || (mode == "drafts" && index == 0) {
                    let model = ItemEditorModel(record: record, services: app)
                    model.fields = fixture.1
                    model.touched(.name); model.touched(.brand); model.touched(.category); model.touched(.color)
                    editor = model
                }
            }
            services = app
        } catch { assertionFailure("gallery setup failed") }
    }
}
