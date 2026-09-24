import SwiftUI
import PhotosUI
import AVFoundation

@MainActor struct OutfitsView: View {
    @EnvironmentObject private var services: AppServices
    @StateObject private var model = OutfitLibraryModel()
    @State private var selected: RemoteOutfit?
    let client: any OutfitServing
    let wardrobe: any WardrobeServing
    @Binding var creating: Bool
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let error = model.error {
                    Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    if model.reconnect { SignInButton() }
                    else { Button("retry") { Task { await model.refresh(client: client) } }.frame(minHeight: 44) }
                }
                if model.loading && model.items.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(.top, 48) }
                else if model.items.isEmpty && model.error == nil {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("no outfits yet").font(CapsuleStyle.heading)
                        Text("choose wardrobe pieces to try on.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                        Button("create outfit") { creating = true }.frame(minHeight: 44)
                    }.padding(.top, 48)
                } else {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible())], spacing: 24) {
                        ForEach(model.items) { outfit in
                            Button { selected = outfit } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    OutfitPhoto(outfit: outfit, client: client).aspectRatio(2 / 3, contentMode: .fit)
                                    Text(outfit.name).font(CapsuleStyle.body).lineLimit(2)
                                    Text(Date(timeIntervalSince1970: outfit.createdAt / 1000), format: .dateTime.month(.abbreviated).day())
                                        .font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                                }
                            }.buttonStyle(.plain).accessibilityLabel("open \(outfit.name)")
                        }
                    }
                }
            }.padding(20)
        }
        .refreshable { await model.refresh(client: client) }
        .task(id: services.wardrobeReloadID) { await model.refresh(client: client) }
        .sheet(isPresented: $creating, onDismiss: { services.wardrobeReloadID = UUID() }) {
            if let userID = services.user?.id {
                NavigationStack {
                    OutfitBuilderView(model: OutfitBuilderModel(client: client, wardrobe: wardrobe, userID: userID, photos: services.modelPhotos, images: services.images)) { _ in
                        creating = false
                        // Detail can be opened from the refreshed grid after the sheet closes.
                        services.wardrobeReloadID = UUID()
                    }
                }
            }
        }
        .sheet(item: $selected, onDismiss: { services.wardrobeReloadID = UUID() }) { outfit in
            NavigationStack { OutfitDetailView(model: OutfitDetailModel(outfit: outfit, client: client), wardrobe: wardrobe) }
        }
    }
}

@MainActor struct OutfitPhoto: View {
    @EnvironmentObject private var services: AppServices
    let outfit: RemoteOutfit
    let client: any OutfitServing
    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0
    var body: some View {
        ZStack {
            CapsuleStyle.canvas
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else if failed { Button { attempt += 1 } label: { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44) }.accessibilityLabel("reload outfit photo") }
            else { ProgressView().controlSize(.small) }
        }.accessibilityLabel(outfit.name)
        .task(id: "\(services.user?.id ?? ""):\(outfit.id):\(outfit.revision):\(attempt)") {
            image = nil; failed = false
            guard let userID = services.user?.id else { return }
            do {
                let data = try await WardrobePhotoCache.shared.load(key: "\(userID):outfit:\(outfit.id):\(outfit.revision)") { try await client.photo(item: outfit) }
                guard !Task.isCancelled, services.user?.id == userID else { return }
                image = UIImage(data: data); failed = image == nil
            } catch { if !Task.isCancelled { failed = true } }
        }
    }
}

@MainActor struct OutfitBuilderView: View {
    @EnvironmentObject private var services: AppServices
    @Environment(\.dismiss) private var dismiss
    @StateObject var model: OutfitBuilderModel
    let onSaved: (RemoteOutfit) -> Void
    @State private var confirmRender = false
    @State private var showSettings = false
    @State private var category: GarmentCategory?
    @State private var discard = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ModelPhotoPanel(model: model)
                if model.loading { ProgressView().frame(maxWidth: .infinity) }
                DisclosureGroup("details") {
                    VStack(alignment: .leading, spacing: 8) {
                    Text("name").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    TextField("outfit", text: $model.name).frame(minHeight: 44)
                    Divider().overlay(CapsuleStyle.divider)
                    HStack(spacing: 0) {
                        Text("styling notes").font(CapsuleStyle.caption)
                        InfoButton(title: "styling notes", paragraphs: ["optional. describe how to wear the pieces, such as tucked in or sleeves rolled."])
                    }
                    TextField("optional", text: $model.notes, axis: .vertical).lineLimit(2...4).frame(minHeight: 44)
                        .onChange(of: model.notes) { _, value in if value.count > 300 { model.notes = String(value.prefix(300)) } }
                    Divider().overlay(CapsuleStyle.divider)
                    }
                }.font(CapsuleStyle.caption).disabled(model.rendering || model.pendingKey != nil)
                HStack {
                    Text("choose pieces").font(CapsuleStyle.heading)
                    Spacer()
                    Text("\(model.selected.count) / 6").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                }
                if model.pieces.isEmpty && !model.loading {
                    Text("add pieces to your wardrobe first.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 20) {
                            categoryButton("all", nil)
                            ForEach(GarmentCategory.allCases) { categoryButton($0.rawValue, $0) }
                        }
                    }
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                        ForEach(model.pieces.filter { category == nil || $0.category == category }) { item in
                            Button { model.toggle(item) } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    WardrobePhoto(item: item, view: item.primaryView, client: model.wardrobe)
                                        .aspectRatio(4 / 5, contentMode: .fit)
                                        .overlay(alignment: .topTrailing) {
                                            if model.selected.contains(item.id) { Image(systemName: "checkmark").font(.system(size: 12)).padding(7).background(CapsuleStyle.canvas) }
                                        }
                                    Text(item.name).font(CapsuleStyle.caption).lineLimit(2)
                                }.opacity(model.selected.count == 6 && !model.selected.contains(item.id) ? 0.45 : 1)
                            }.buttonStyle(.plain).disabled(model.rendering || model.pendingKey != nil || (!model.selected.contains(item.id) && model.selected.count >= 6))
                                .accessibilityLabel(item.name).accessibilityAddTraits(model.selected.contains(item.id) ? .isSelected : [])
                        }
                    }
                }
            }.padding(20)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .leading, spacing: 8) {
                if let config = model.config {
                    HStack(spacing: 0) {
                        Text("model: \(config.model)").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                        InfoButton(title: "outfit rendering", paragraphs: ["your model photo and selected pieces go to OpenAI when you render. usage is billed to your OpenAI account."])
                    }
                    if !config.hasSavedKey { Button("set up rendering in settings") { showSettings = true }.frame(minHeight: 44) }
                    if !config.enabled { Text("rendering is unavailable right now.").font(CapsuleStyle.caption) }
                }
                if let error = model.error {
                    Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    if model.config == nil { Button("retry") { Task { await model.load() } }.frame(minHeight: 44) }
                }
                if model.pendingKey != nil {
                    if model.rendering { HStack { ProgressView().controlSize(.small); Text("rendering…").font(CapsuleStyle.caption) } }
                    else {
                        Button("check render") { Task { await model.checkRender() } }.capsulePrimaryAction()
                        Text("your render may still be finishing.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    }
                } else {
                    Button { confirmRender = true } label: {
                        HStack { Spacer(); if model.rendering { ProgressView().controlSize(.small) }; Text(model.rendering ? "preparing…" : "render outfit"); Spacer() }
                    }.capsulePrimaryAction().disabled(!model.canRender)
                }
            }.padding(.horizontal, 20).padding(.vertical, 12).frame(maxWidth: .infinity).background(CapsuleStyle.canvas)
        }
        .buttonStyle(.plain).capsuleScreen().scrollDismissesKeyboard(.interactively)
        .navigationTitle("create outfit").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { Text("create outfit").font(CapsuleStyle.heading) }
            ToolbarItem(placement: .topBarTrailing) {
                Button { if !model.selected.isEmpty && model.pendingKey == nil { discard = true } else { dismiss() } } label: { Image(systemName: "xmark").font(.system(size: 14)).frame(width: 44, height: 44) }.accessibilityLabel("close").disabled(model.rendering || model.importingPhoto)
            }.quietBackground()
        }
        .interactiveDismissDisabled(model.rendering || model.importingPhoto || !model.selected.isEmpty)
        .task { await model.load(); if model.pendingKey != nil { await model.checkRender() } }
        .task(id: model.pendingKey) {
            guard let key = model.pendingKey else { return }
            while model.pendingKey == key && !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                if !model.rendering { await model.checkRender(); if model.error != nil { return } }
            }
        }
        .onChange(of: model.result) { _, value in if let value { onSaved(value) } }
        .sheet(isPresented: $showSettings, onDismiss: { Task { await model.load() } }) { NavigationStack { SettingsView() } }
        .alert("render with OpenAI?", isPresented: $confirmRender) {
            Button("render outfit") { Task { await model.render() } }
            Button("cancel", role: .cancel) {}
        } message: { Text("sends your model photo and selected pieces to OpenAI. usage is billed to your account. the result saves to capsule.") }
        .alert("discard this selection?", isPresented: $discard) {
            Button("discard", role: .destructive) { dismiss() }
            Button("keep editing", role: .cancel) {}
        }
    }
    private func categoryButton(_ title: String, _ value: GarmentCategory?) -> some View {
        Button { category = value } label: { Text(title).font(CapsuleStyle.caption).foregroundStyle(category == value ? CapsuleStyle.text : CapsuleStyle.secondary).frame(minHeight: 44) }.accessibilityAddTraits(category == value ? .isSelected : [])
    }
}

@MainActor private struct ModelPhotoPanel: View {
    @ObservedObject var model: OutfitBuilderModel
    @State private var picker: PhotosPickerItem?
    @State private var library = false
    @State private var camera = false
    @State private var denied = false
    private var busy: Bool { model.loading || model.rendering || model.importingPhoto || model.pendingKey != nil }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 0) {
                Text("your model photo").font(CapsuleStyle.heading)
                InfoButton(title: "your model photo", paragraphs: ["saved on this iPhone for your account and reused for future outfits. sent to OpenAI only when you render."])
                Spacer(minLength: 0)
                if model.photo != nil {
                    photoMenu(icon: true)
                    Button { Task { await model.setPhoto(nil) } } label: { Image(systemName: "trash").font(.system(size: 14)).frame(width: 44, height: 44) }.accessibilityLabel("remove model photo").disabled(busy)
                }
            }
            Text("a full-body photo or mirror selfie, facing the camera and visible from head to toe.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
            if let data = model.photo, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity).frame(height: 190).padding(.top, 8)
            } else {
                ZStack {
                    ModelPhotoSilhouette().fill(CapsuleStyle.secondary.opacity(0.27)).aspectRatio(160 / 260, contentMode: .fit)
                    photoMenu(icon: false)
                }.frame(maxWidth: .infinity).frame(height: 190)
            }
            if model.importingPhoto { ProgressView().controlSize(.small) }
        }
        .photosPicker(isPresented: $library, selection: $picker, matching: .images)
        .onChange(of: picker) { _, value in
            guard let value else { return }
            model.importingPhoto = true
            Task {
                do {
                    guard let data = try await value.loadTransferable(type: Data.self) else { throw ScanError.invalidImage }
                    await model.setPhoto(data)
                } catch { model.error = "couldn’t open this photo. try another."; model.importingPhoto = false }
                picker = nil
            }
        }
        .sheet(isPresented: $camera) { CameraPicker { data in camera = false; if let data { Task { await model.setPhoto(data) } } }.ignoresSafeArea() }
        .alert("camera access is off", isPresented: $denied) {
            Button("open settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
            Button("cancel", role: .cancel) {}
        } message: { Text("allow camera access in settings, or choose a photo from your library.") }
    }
    private func photoMenu(icon: Bool) -> some View {
        Menu {
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("take a photo", systemImage: "camera") {
                    Task { if await AVCaptureDevice.requestAccess(for: .video) { camera = true } else { denied = true } }
                }
            }
            Button("photo library", systemImage: "photo.on.rectangle") { library = true }
        } label: {
            if icon { Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 14)).frame(width: 44, height: 44) }
            else { Text("add photo").frame(minHeight: 44) }
        }.accessibilityLabel(icon ? "change model photo" : "add model photo").disabled(busy)
    }
}

@MainActor struct OutfitDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject var model: OutfitDetailModel
    let wardrobe: any WardrobeServing
    @State private var pieces: [RemoteWardrobeItem] = []
    @State private var selected: RemoteWardrobeItem?
    @State private var remove = false
    @State private var discard = false
    @State private var downloading = false
    @State private var notice: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                OutfitPhoto(outfit: model.outfit, client: model.client).aspectRatio(2 / 3, contentMode: .fit)
                TextField("outfit name", text: $model.name).frame(minHeight: 44).accessibilityLabel("outfit name")
                Divider().overlay(CapsuleStyle.divider)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 16) {
                        ForEach(pieces) { piece in
                            Button { selected = piece } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    WardrobePhoto(item: piece, view: piece.primaryView, client: wardrobe).frame(width: 80, height: 100)
                                    Text(piece.name).font(CapsuleStyle.caption).lineLimit(2)
                                }.frame(width: 80)
                            }.buttonStyle(.plain)
                        }
                    }
                }
                if let error = model.error { Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
                if model.conflict { Button("reload outfit") { Task { await model.reload() } }.frame(minHeight: 44) }
                if let notice { Text(notice).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
                HStack {
                    Button("save image") { saveImage() }.frame(minHeight: 44).disabled(downloading)
                    Spacer()
                    Button { remove = true } label: { Image(systemName: "trash").font(.system(size: 14)).frame(width: 44, height: 44) }.accessibilityLabel("remove outfit")
                }
            }.padding(20).disabled(model.busy)
        }.buttonStyle(.plain).capsuleScreen().navigationTitle(model.outfit.name).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { Text(model.outfit.name).font(CapsuleStyle.heading).lineLimit(1) }
            ToolbarItem(placement: .topBarLeading) { Button { if model.changed { discard = true } else { dismiss() } } label: { Image(systemName: "xmark").font(.system(size: 14)).frame(width: 44, height: 44) }.accessibilityLabel("close").disabled(model.busy) }.quietBackground()
            ToolbarItem(placement: .topBarTrailing) { Button("save") { Task { await model.save() } }.disabled(!model.changed || model.busy || model.conflict).font(CapsuleStyle.body) }.quietBackground()
        }
        .interactiveDismissDisabled(model.changed || model.busy)
        .task {
            for id in model.outfit.itemIds { if let item = try? await wardrobe.item(id: id), !Task.isCancelled { pieces.append(item) } }
        }
        .sheet(item: $selected) { item in NavigationStack { WardrobeDetailView(model: WardrobeDetailModel(item: item, client: wardrobe, images: ImageProcessor(), isolation: VisionImageIsolator()), client: wardrobe) } }
        .alert("remove this outfit?", isPresented: $remove) {
            Button("remove", role: .destructive) { Task { await model.save(remove: true); if model.removed { dismiss() } } }
            Button("cancel", role: .cancel) {}
        } message: { Text("your wardrobe pieces stay saved.") }
        .alert("save changes?", isPresented: $discard) {
            Button("save changes") { Task { await model.save(); if !model.changed && model.error == nil { dismiss() } } }
            Button("discard changes", role: .destructive) { dismiss() }
            Button("keep editing", role: .cancel) {}
        }
    }
    private func saveImage() {
        downloading = true; notice = nil
        Task {
            defer { downloading = false }
            do {
                let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                guard status == .authorized || status == .limited else { notice = "allow photo access in iPhone settings to save images."; return }
                let data = try await model.client.photo(item: model.outfit)
                try await PHPhotoLibrary.shared().performChanges { PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil) }
                notice = "saved to photos"
            } catch { notice = "couldn’t save the image. try again." }
        }
    }
}
