import SwiftUI

@MainActor struct SettingsView: View {
    @EnvironmentObject private var services: AppServices
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var visionKey = ""
    @State private var error: String?
    @State private var busy = false
    @State private var confirmVision = false

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
                            "on-device processing fills in color only. name, brand, and category stay blank.",
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
                        Button(services.hasVisionKey ? "replace key" : "save key") { confirmVision = true }
                            .frame(minHeight: 44)
                            .disabled(visionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                        Spacer()
                        if services.hasVisionKey {
                            Button("remove key", role: .destructive) { update(remove: true) }
                                .foregroundStyle(CapsuleStyle.secondary)
                                .frame(minHeight: 44).disabled(busy)
                        }
                    }
                    if services.hasVisionKey && !services.visionEnabled {
                        Button("enable photo details") { confirmVision = true }.frame(minHeight: 44).disabled(busy)
                    }
                    if let error {
                        Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
                if let client = services.outfits {
                    OutfitSettingsView(client: client).id(services.user?.id)
                } else if services.connected {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("outfit rendering").font(CapsuleStyle.heading)
                        Text("sign in again to connect your outfits.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                        SignInButton().frame(minHeight: 44)
                    }
                }
                HStack(spacing: 0) {
                    Toggle("usage analytics", isOn: Binding(get: { services.analyticsEnabled }, set: { services.setAnalyticsEnabled($0) }))
                    InfoButton(title: "usage analytics", paragraphs: ["helps improve capsule with screen visits and feature usage. linked to your account when signed in. no photos, item details, or keys.", "turn off anytime on this iphone. no screen recording or advertising."])
                }
                VStack(alignment: .leading, spacing: 0) {
                    SupportLink()
                    Link("terms of service", destination: URL(string: "https://capsule.gtfol.dev/terms")!).frame(minHeight: 44)
                    Link("privacy policy", destination: URL(string: "https://capsule.gtfol.dev/privacy")!).frame(minHeight: 44)
                    Link("contact us", destination: URL(string: "https://gtfol.dev/contact")!).frame(minHeight: 44)
                }.foregroundStyle(CapsuleStyle.secondary)
                if services.user != nil {
                    Link("delete account", destination: URL(string: "https://capsule.gtfol.dev/?view=settings")!)
                        .foregroundStyle(CapsuleStyle.secondary).frame(minHeight: 44)
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
        .task { services.analytics.track(.screen(.settings)); await services.refreshCredentials() }
        .onDisappear { visionKey = "" }
        .alert("send photos to OpenAI?", isPresented: $confirmVision) {
            Button("allow") { update(remove: false) }
            Button("cancel", role: .cancel) {}
        } message: {
            Text("new garment photos will be sent to OpenAI to fill in details. usage is billed to your OpenAI account. remove your key anytime to return to on-device color detection.")
        }
    }
    private var extractionStatus: some View {
        Text(services.visionEnabled ? "openai" : "color only")
            .font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
    }
    private func update(remove: Bool) {
        busy = true; error = nil
        Task {
            do {
                if remove { try await services.removeVisionKey() }
                else { try await services.enableVision(key: visionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : visionKey) }
                visionKey = ""
            } catch { self.error = ScanError.keychain.localizedDescription }
            busy = false
        }
    }
}
