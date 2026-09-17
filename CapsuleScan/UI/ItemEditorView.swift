import SwiftUI

@MainActor struct ItemEditorView: View {
    @EnvironmentObject private var services: AppServices
    @Environment(\.dismiss) private var dismiss
    @StateObject var model: ItemEditorModel
    var onSaved: () -> Void = {}
    @State private var confirmDiscard = false

    var body: some View {
        Form {
            if let data = model.image, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: 300)
                    .accessibilityLabel("garment photo").listRowBackground(Color.clear)
            }
            if model.extracting { HStack { ProgressView(); Text("reading details…").font(.footnote).foregroundStyle(.secondary) } }
            if let message = model.message { Text(message).font(.footnote).foregroundStyle(.secondary) }
            Section("item") {
                LabeledContent("name") { TextField("name", text: binding(\.name, field: .name)).multilineTextAlignment(.trailing).accessibilityLabel("name") }
                LabeledContent("brand") { TextField("brand", text: binding(\.brand, field: .brand)).multilineTextAlignment(.trailing).accessibilityLabel("brand") }
                Picker("category", selection: Binding(get: { model.fields.category }, set: { model.touched(.category); model.fields.category = $0 })) {
                    Text("not set").tag(Optional<GarmentCategory>.none)
                    ForEach(GarmentCategory.allCases) { Text($0.rawValue).tag(Optional($0)) }
                }
                LabeledContent("color") { TextField("color", text: binding(\.color, field: .color)).multilineTextAlignment(.trailing).accessibilityLabel("color") }
                LabeledContent("size") { TextField("size", text: $model.fields.size).multilineTextAlignment(.trailing).accessibilityLabel("size") }
                LabeledContent("price") { TextField("optional", text: $model.priceText).keyboardType(.decimalPad).multilineTextAlignment(.trailing).accessibilityLabel("price") }
                LabeledContent("currency") { TextField("usd", text: $model.fields.currency).textInputAutocapitalization(.characters).autocorrectionDisabled().multilineTextAlignment(.trailing).accessibilityLabel("currency") }
            }.disabled(model.saving)
            Section {
                if model.record?.capsuleSaveState.completed == true {
                    Text(model.record!.capsuleSaveState.label)
                    Text("changes are saved on this iphone only.").font(.caption).foregroundStyle(.secondary)
                } else {
                    Toggle("save to capsule", isOn: $model.sendToCapsule).disabled(!services.connected || model.saving)
                    if !services.connected {
                        Text("not connected. save locally, or connect in settings.").font(.caption).foregroundStyle(.secondary)
                        NavigationLink("settings") { SettingsView() }
                    } else if model.sendToCapsule && model.fields.category == nil {
                        Text("choose a category, or capsule will use tops.").font(.caption).foregroundStyle(.secondary)
                    }
                    if let error = model.record?.lastCapsuleError, model.error == nil { Text(error).font(.footnote).foregroundStyle(.secondary) }
                }
            } footer: { Text("items are saved on this iphone.") }
            if let error = model.error { Text(error).font(.footnote).foregroundStyle(.secondary).accessibilityAddTraits(.updatesFrequently) }
            Button {
                Task { if await model.save() { onSaved(); dismiss() } }
            } label: {
                HStack { Spacer(); if model.saving { ProgressView() }; Text(model.saving ? "saving…" : model.record?.capsuleSaveState == .failed && model.sendToCapsule ? "save and retry" : "save"); Spacer() }
            }.disabled(model.saving || (model.image == nil && model.record == nil))
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(model.record == nil ? "review item" : "edit item")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("close") { if model.hasUnsavedChanges { confirmDiscard = true } else { dismiss() } }.disabled(model.saving) } }
        .confirmationDialog("leave without saving changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("discard changes", role: .destructive) { dismiss() }
            Button("keep editing", role: .cancel) {}
        }
        .interactiveDismissDisabled()
        .task { await model.start() }
        .onDisappear { model.stopExtraction() }
    }
    private func binding(_ keyPath: WritableKeyPath<ItemFields, String>, field: ItemEditorModel.Field) -> Binding<String> {
        Binding(get: { model.fields[keyPath: keyPath] }, set: { model.touched(field); model.fields[keyPath: keyPath] = $0 })
    }
}
