import SwiftUI

@MainActor struct SettingsView: View {
    @EnvironmentObject private var services: AppServices
    @State private var capsuleToken = ""
    @State private var visionKey = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        Form {
            Section {
                LabeledContent("capsule", value: services.connected ? "connected" : "not connected")
                SecureField("integration token", text: $capsuleToken).textContentType(nil).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(services.connected ? "replace token" : "connect capsule") { update(capsuleToken, kind: .capsuleToken) }.disabled(capsuleToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                if services.connected { Button("disconnect", role: .destructive) { update(nil, kind: .capsuleToken) }.disabled(busy) }
                Link("open capsule settings", destination: URL(string: "https://capsule.gtfol.dev/?view=settings")!)
            } header: { Text("capsule") } footer: {
                Text("in capsule, open settings → integrations and create a token with wardrobe:write. your token stays in keychain.")
            }
            if let message = services.connectionMessage { Text(message).font(.footnote).foregroundStyle(.secondary) }
            Section {
                LabeledContent("extractor", value: services.visionEnabled ? "openai vision" : "on device")
                SecureField("openai api key", text: $visionKey).textContentType(nil).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(services.visionEnabled ? "replace key" : "save key") { update(visionKey, kind: .visionAPIKey) }.disabled(visionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                if services.visionEnabled { Button("remove key", role: .destructive) { update(nil, kind: .visionAPIKey) }.disabled(busy) }
            } header: { Text("draft extraction") } footer: {
                Text("optional. adding a key sends new garment photos to openai to draft details, using gpt-4.1-mini. billed to your openai account. without a key, color is estimated on this iphone. keys stay in keychain.")
            }
            if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
            Section { Text("capsule scan").font(.footnote).foregroundStyle(.secondary) }
        }
        .navigationTitle("settings")
        .navigationBarTitleDisplayMode(.inline)
        .task { await services.refreshCredentials() }
        .onDisappear { capsuleToken = ""; visionKey = "" }
    }
    private func update(_ value: String?, kind: Credential) {
        busy = true; error = nil
        Task {
            do {
                try await services.setCredential(value, for: kind)
                capsuleToken = ""; visionKey = ""
            } catch { self.error = ScanError.keychain.localizedDescription }
            busy = false
        }
    }
}
