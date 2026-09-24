import SwiftUI

@MainActor struct OutfitSettingsView: View {
    let client: any OutfitServing
    @State private var config: OutfitConfig?
    @State private var key = ""
    @State private var busy = false
    @State private var error: String?
    @State private var removing = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 0) {
                Text("outfit rendering").font(CapsuleStyle.heading)
                InfoButton(title: "outfit rendering", paragraphs: ["your OpenAI key is encrypted in your capsule account and shared with the web app. photos are sent only when you choose to render. usage is billed to your OpenAI account."])
                Spacer(minLength: 0)
                if config?.hasSavedKey == true { Text("key saved").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
            }
            if let config {
                Text("model: \(config.model)").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                if config.keyStorageAvailable {
                    SecureField(config.hasSavedKey ? "replace openai api key" : "openai api key", text: $key)
                        .textContentType(nil).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .frame(minHeight: 44).overlay(alignment: .bottom) { Rectangle().fill(CapsuleStyle.divider).frame(height: 1) }
                    HStack {
                        Button(config.hasSavedKey ? "replace key" : "save key") { update(remove: false) }.frame(minHeight: 44).disabled(key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
                        Spacer()
                        if config.hasSavedKey {
                            Button { removing = true } label: { Image(systemName: "trash").font(.system(size: 14)).frame(width: 44, height: 44) }.accessibilityLabel("remove rendering key").disabled(busy)
                        }
                    }
                } else { Text("saving keys is unavailable right now.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
            } else if busy { ProgressView().controlSize(.small) }
            if let error { Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
            if config == nil && !busy { Button("retry") { Task { await load() } }.frame(minHeight: 44) }
        }
        .task { await load() }
        .onDisappear { key = "" }
        .alert("remove rendering key?", isPresented: $removing) {
            Button("remove", role: .destructive) { update(remove: true) }
            Button("cancel", role: .cancel) {}
        } message: { Text("removes the saved key from your capsule account, including the web app.") }
    }
    private func load() async {
        busy = true; defer { busy = false }
        do { config = try await client.config(); error = nil }
        catch { self.error = error.localizedDescription }
    }
    private func update(remove: Bool) {
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                try await client.saveKey(remove ? nil : key.trimmingCharacters(in: .whitespacesAndNewlines))
                key = ""; config = try await client.config()
            } catch { self.error = error.localizedDescription }
        }
    }
}
