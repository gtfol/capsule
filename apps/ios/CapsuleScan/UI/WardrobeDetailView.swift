import SwiftUI
import PhotosUI

@MainActor struct WardrobeDetailView: View {
    @EnvironmentObject private var services: AppServices
    @Environment(\.dismiss) private var dismiss
    @StateObject var model: WardrobeDetailModel
    let client: any WardrobeServing
    @State private var view: GarmentView = .front
    @State private var importing = false
    @State private var photo: PhotosPickerItem?
    @State private var cameraView: GarmentView = .front
    @State private var pendingCamera: Data?
    @State private var camera = false
    @State private var cameraDenied = false
    @State private var confirmClose = false
    @State private var confirmDelete = false
    @State private var confirmReload = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Picker("photo view", selection: $view) {
                    ForEach(GarmentView.allCases) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.segmented).disabled(model.processing || importing)
                photoPreview.frame(height: 300)
                photoActions
                fields
                if let error = model.error {
                    Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    if model.needsSignIn { SignInButton() }
                    if model.conflict { Button("reload item") { confirmReload = true }.frame(minHeight: 44) }
                }
                Button {
                    Task { if await model.save() { services.wardrobeReloadID = UUID(); dismiss() } }
                } label: { HStack { Spacer(); if model.busy { ProgressView() }; Text(model.busy ? "saving…" : "save changes"); Spacer() } }
                    .capsulePrimaryAction().disabled(model.busy || model.processing || importing || !model.hasChanges)
                Button("delete piece", role: .destructive) { confirmDelete = true }
                    .font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).frame(minHeight: 44)
                    .disabled(model.busy || model.processing || importing)
            }.padding(20)
        }
        .capsuleScreen().scrollDismissesKeyboard(.interactively)
        .navigationTitle("edit item").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { Text("edit item").font(CapsuleStyle.heading) }
            ToolbarItem(placement: .cancellationAction) {
                Button { if model.hasChanges { confirmClose = true } else { dismiss() } } label: { Image(systemName: "xmark").font(.system(size: 14)).frame(width: 44, height: 44) }.accessibilityLabel("close").disabled(model.busy || model.processing || importing)
            }.quietBackground()
        }
        .interactiveDismissDisabled(model.hasChanges || model.busy || model.processing || importing)
        .confirmationDialog("save changes?", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("save changes") { Task { if await model.save() { services.wardrobeReloadID = UUID(); dismiss() } } }
            Button("discard changes", role: .destructive) { dismiss() }
            Button("keep editing", role: .cancel) {}
        }
        .confirmationDialog("delete this piece?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("delete piece", role: .destructive) { Task { if await model.remove() { services.wardrobeReloadID = UUID(); dismiss() } } }
            Button("cancel", role: .cancel) {}
        } message: { Text("removed from your capsule wardrobe on every device.") }
        .confirmationDialog("reload and discard your changes?", isPresented: $confirmReload, titleVisibility: .visible) {
            Button("reload item", role: .destructive) { Task { await model.reload() } }
            Button("cancel", role: .cancel) {}
        }
        .onChange(of: photo) { _, value in
            guard let value else { return }; let target = view
            importing = true
            Task {
                do {
                    guard let data = try await value.loadTransferable(type: Data.self) else { throw ScanError.invalidImage }
                    await model.replacePhoto(data, view: target)
                } catch { model.photoFailed() }
                photo = nil; importing = false
            }
        }
        .sheet(isPresented: $camera, onDismiss: {
            if let data = pendingCamera { pendingCamera = nil; let target = cameraView; Task { await model.replacePhoto(data, view: target) } }
        }) { CameraPicker { pendingCamera = $0; camera = false }.ignoresSafeArea() }
        .alert("camera access is off", isPresented: $cameraDenied) {
            Button("open settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
            Button("cancel", role: .cancel) {}
        } message: { Text("allow camera access in settings, or choose a photo.") }
        .onAppear { view = model.item.primaryView }
    }
    @ViewBuilder private var photoPreview: some View {
        if let data = model.previews[view], let image = UIImage(data: data) { Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity) }
        else if model.edit.photos[view] == "" { Text("no photo").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).frame(maxWidth: .infinity) }
        else { WardrobePhoto(item: model.item, view: view, client: client) }
    }
    private var hasPhoto: Bool { model.previews[view] != nil || (model.edit.photos[view] != "" && model.item.hasPhoto(view)) }
    private var photoActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .current) {
                    Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44)
                }.accessibilityLabel("upload \(view.rawValue) photo")
                Button {
                    let target = view
                    Task { if await CameraAuthorization().requestAccess() { cameraView = target; camera = true } else { cameraDenied = true } }
                } label: { Image(systemName: "camera").frame(width: 44, height: 44) }
                    .accessibilityLabel("take \(view.rawValue) photo").disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                if hasPhoto {
                    Button { let target = view; Task { await model.cutout(target) } } label: { Image(systemName: "scissors").frame(width: 44, height: 44) }.accessibilityLabel("remove background")
                    Spacer(minLength: 0)
                    Button("remove \(view.rawValue)") { model.removePhoto(view) }.font(CapsuleStyle.caption).frame(minHeight: 44)
                }
            }.disabled(model.busy || model.processing || importing)
            if model.hasOriginal(view) { Button("restore original") { model.restorePhoto(view) }.font(CapsuleStyle.caption).frame(minHeight: 44).disabled(model.busy || model.processing || importing) }
            if model.processing || importing { ProgressView("processing photo…").font(CapsuleStyle.caption) }
        }.font(.system(size: 15)).buttonStyle(.plain)
    }
    private var fields: some View {
        VStack(spacing: 0) {
            field("name", text: $model.edit.fields.name)
            field("brand", text: $model.edit.fields.brand)
            Picker("category", selection: $model.edit.fields.category) {
                ForEach(GarmentCategory.allCases) { Text($0.rawValue).tag(Optional($0)) }
            }.frame(minHeight: 48)
            Divider().overlay(CapsuleStyle.divider)
            field("color", text: $model.edit.fields.color)
            field("size", text: $model.edit.fields.size)
            field("price", text: $model.priceText, keyboard: .decimalPad)
            field("currency", text: $model.edit.fields.currency)
            field("purchase link", text: $model.edit.url, keyboard: .URL)
            TextField("description", text: $model.edit.description, axis: .vertical).lineLimit(3...8).padding(.vertical, 16).accessibilityLabel("description")
        }.disabled(model.busy)
    }
    private func field(_ title: String, text: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        VStack(spacing: 0) {
            LabeledContent(title) { TextField(title, text: text).keyboardType(keyboard).autocorrectionDisabled().textInputAutocapitalization(.never).multilineTextAlignment(.trailing).accessibilityLabel(title) }.frame(minHeight: 48)
            Divider().overlay(CapsuleStyle.divider)
        }
    }
}
