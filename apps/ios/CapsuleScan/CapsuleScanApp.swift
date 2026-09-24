import SwiftUI
import SwiftData

@main @MainActor struct CapsuleScanApp: App {
    @State private var services: AppServices?
    @State private var startupError = false
    var body: some Scene {
        WindowGroup {
            Group {
                if let services {
                    WardrobeView().environmentObject(services).modelContainer(services.container)
                } else {
                    VStack(spacing: 16) {
                        Text("capsule").font(CapsuleStyle.heading)
                        if startupError {
                            Text("couldn’t open your drafts. try again.").foregroundStyle(CapsuleStyle.secondary)
                            Button("try again", action: start)
                        } else { ProgressView().task { start() } }
                    }.padding()
                }
            }
            .preferredColorScheme(.dark)
            .font(CapsuleStyle.body)
            .tint(CapsuleStyle.text)
        }
    }
    @MainActor private func start() {
        do {
            let support = URL.applicationSupportDirectory
            let container = try SwiftDataItemStore.makeContainer(in: support)
            let directory = support.appendingPathComponent("garment-files", isDirectory: true)
            let app = AppServices(container: container, media: LocalMediaStore(directory: directory))
            try app.items.recoverInterruptedSaves()
            services = app
        } catch { startupError = true }
    }
}
