import SwiftUI

@MainActor struct ItemEditorView: View {
    @EnvironmentObject private var services: AppServices
    @Environment(\.dismiss) private var dismiss
    @StateObject var model: ItemEditorModel
    var onSaved: (CapsuleSaveState) -> Void = { _ in }
    @State private var confirmDiscard = false

    var body: some View {
        List {
            if let data = model.image, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: 300)
                    .accessibilityLabel("garment photo").listRowBackground(Color.clear).listRowSeparator(.hidden)
            }
            if model.extracting { HStack { ProgressView(); Text("reading details…").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }.listRowSeparator(.hidden) }
            if let message = model.message { Text(message).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).listRowSeparator(.hidden) }
            Section {
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
            } header: { Text("item").font(CapsuleStyle.heading).foregroundStyle(CapsuleStyle.text).textCase(nil) }
            .listRowBackground(Color.clear)
            .listRowSeparatorTint(CapsuleStyle.divider)
            .listSectionSeparator(.hidden)
            .disabled(model.saving)
            Group {
                if !services.connected {
                    SignInButton()
                } else if model.fields.category == nil {
                    Text("capsule uses tops if no category is chosen.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                }
                if let error = model.record?.lastCapsuleError, model.error == nil { Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
                if let message = services.connectionMessage { Text(message).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
            }.listRowBackground(Color.clear).listRowSeparator(.hidden)
            if let error = model.error { Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).accessibilityAddTraits(.updatesFrequently).listRowSeparator(.hidden) }
            Button {
                Task { if await model.save() { onSaved(model.record?.capsuleSaveState ?? .saved); dismiss() } }
            } label: {
                HStack { Spacer(); if model.saving { ProgressView().tint(CapsuleStyle.canvas) }; Text(model.saving ? "saving…" : model.record?.capsuleSaveState == .failed ? "retry save to capsule" : "save to capsule"); Spacer() }
            }
            .capsulePrimaryAction()
            .listRowBackground(Color.clear).listRowSeparator(.hidden)
            .disabled(!services.connected || model.saving || (model.image == nil && model.record == nil))
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .capsuleScreen()
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(model.record == nil ? "review item" : "edit item")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .principal) { Text(model.record == nil ? "review item" : "edit item").font(CapsuleStyle.heading) }
            ToolbarItem(placement: .cancellationAction) {
                Button { if model.hasUnsavedChanges { confirmDiscard = true } else { dismiss() } } label: {
                    Image(systemName: "xmark").font(.system(size: 14)).frame(width: 44, height: 44)
                }.accessibilityLabel("close").disabled(model.saving)
            }.quietBackground()
        }
        .confirmationDialog("leave without saving changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("save draft") { Task { if await model.saveDraft() { onSaved(.notSaved); dismiss() } } }
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
