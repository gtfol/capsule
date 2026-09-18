import SwiftUI

@MainActor struct SettingsView: View {
    @EnvironmentObject private var services: AppServices
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var visionKey = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("capsule").font(CapsuleStyle.heading)
                    if let user = services.user {
                        Text(user.name.isEmpty ? "signed in" : user.name)
                            .foregroundStyle(CapsuleStyle.secondary)
                        HStack {
                            Link("open wardrobe", destination: URL(string: "https://capsule.gtfol.dev/?view=wardrobe")!)
                                .frame(minHeight: 44)
                            Spacer()
                            Button("sign out", role: .destructive) { Task { await services.signOut() } }
                                .foregroundStyle(CapsuleStyle.secondary)
                                .frame(minHeight: 44).disabled(services.authenticating)
                        }
                    } else {
                        SignInButton().frame(minHeight: 44)
                    }
                    if let message = services.connectionMessage {
                        Text(message).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 0) {
                        Text("photo details").font(CapsuleStyle.heading)
                        InfoButton(title: "photo details", paragraphs: [
                            "without a key, color is estimated on this iphone.",
                            "with a key, photos go to OpenAI’s gpt-4.1-mini to fill in details. usage is billed to your OpenAI account.",
                            "your key stays in Keychain."
                        ])
                        Spacer(minLength: 0)
                        if !dynamicTypeSize.isAccessibilitySize { extractionStatus.fixedSize() }
                    }
                    if dynamicTypeSize.isAccessibilitySize { extractionStatus }
                    SecureField("openai api key", text: $visionKey,
                                prompt: Text("openai api key").foregroundStyle(CapsuleStyle.secondary))
                        .textContentType(nil).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityLabel("openai api key")
                        .padding(.vertical, 12).frame(minHeight: 44)
                        .overlay(alignment: .bottom) { Rectangle().fill(CapsuleStyle.divider).frame(height: 1) }
                    HStack {
                        Button(services.visionEnabled ? "replace key" : "save key") { update(visionKey) }
                            .frame(minHeight: 44)
                            .disabled(visionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                        Spacer()
                        if services.visionEnabled {
                            Button("remove key", role: .destructive) { update(nil) }
                                .foregroundStyle(CapsuleStyle.secondary)
                                .frame(minHeight: 44).disabled(busy)
                        }
                    }
                    if let error {
                        Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20).padding(.vertical, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .capsuleScreen()
        .navigationTitle("settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .principal) { Text("settings").font(CapsuleStyle.heading) } }
        .task { await services.refreshCredentials() }
        .onDisappear { visionKey = "" }
    }
    private var extractionStatus: some View {
        Text(services.visionEnabled ? "openai" : "on device")
            .font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
    }
    private func update(_ value: String?) {
        busy = true; error = nil
        Task {
            do {
                try await services.setCredential(value, for: .visionAPIKey)
                visionKey = ""
            } catch { self.error = ScanError.keychain.localizedDescription }
            busy = false
        }
    }
}
