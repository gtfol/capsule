import SwiftUI
import PhotosUI
import AVFoundation

protocol CameraAuthorizing: Sendable { func requestAccess() async -> Bool }
struct CameraAuthorization: CameraAuthorizing {
    func requestAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }
}

private struct PhotoDraft: Identifiable { let id = UUID(); let image: Data }

@MainActor struct CaptureView: View {
    var inWardrobe = false
    var onUploaded: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var services: AppServices
    @Environment(\.scenePhase) private var scenePhase
    @State private var photo: PhotosPickerItem?
    @State private var draft: PhotoDraft?
    @State private var showingCamera = false
    @State private var pendingCameraPhoto: Data?
    @State private var cameraDenied = false
    @State private var processing = false
    @State private var notice: String?
    @State private var error: String?
    private let camera: any CameraAuthorizing = CameraAuthorization()

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                if !services.credentialsReady {
                    ProgressView()
                } else if !services.connected {
                    Text("add to your capsule wardrobe").font(CapsuleStyle.heading).multilineTextAlignment(.center)
                    SignInButton().capsulePrimaryAction()
                    if let message = services.connectionMessage { Text(message).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
                } else {
                VStack(spacing: 8) {
                    Text("add an item").font(CapsuleStyle.heading)
                    Text("one garment, fully in frame.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).multilineTextAlignment(.center)
                }
                VStack(spacing: 12) {
                    Button {
                        Task {
                            if await camera.requestAccess() { showingCamera = true }
                            else { cameraDenied = true }
                        }
                    } label: { Label("take a photo", systemImage: "camera").frame(maxWidth: .infinity) }
                    .capsulePrimaryAction()
                    .disabled(processing || !UIImagePickerController.isSourceTypeAvailable(.camera))
                    PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .current) {
                        Label("choose a photo", systemImage: "photo").frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(.plain).disabled(processing)
                    if !UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Text("camera unavailable. choose a photo.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    }
                }.controlSize(.large)
                if processing { ProgressView("preparing photo…").font(CapsuleStyle.caption) }
                if let error { Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).accessibilityAddTraits(.updatesFrequently) }
                if let notice { Text(notice).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).accessibilityAddTraits(.updatesFrequently) }
                if !inWardrobe { Link("open wardrobe", destination: URL(string: "https://capsule.gtfol.dev/?view=wardrobe")!).font(CapsuleStyle.caption).frame(minHeight: 44) }
                }
                Spacer()
            }
            .padding(.horizontal, 20).padding(.vertical, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .capsuleScreen()
            .navigationTitle(inWardrobe ? "add to wardrobe" : "capsule")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { Text(inWardrobe ? "add to wardrobe" : "capsule").font(CapsuleStyle.heading) }
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink { DraftsView() } label: { Image(systemName: "tray").font(.system(size: 15)).frame(width: 44, height: 44) }.accessibilityLabel("drafts")
                }.quietBackground()
                ToolbarItem(placement: .topBarTrailing) {
                    if inWardrobe {
                        Button { dismiss() } label: { Image(systemName: "xmark").font(.system(size: 14)).frame(width: 44, height: 44) }.accessibilityLabel("close")
                    } else { NavigationLink { SettingsView() } label: { Image(systemName: "gearshape").font(.system(size: 15)).frame(width: 44, height: 44) }.accessibilityLabel("settings") }
                }.quietBackground()
            }
            .sheet(isPresented: $showingCamera, onDismiss: {
                // Present review only after the camera sheet has finished dismissing.
                if let data = pendingCameraPhoto { pendingCameraPhoto = nil; prepare(data) }
            }) {
                CameraPicker { data in pendingCameraPhoto = data; showingCamera = false }
                    .ignoresSafeArea()
            }
            .sheet(item: $draft) { draft in
                NavigationStack {
                    ItemEditorView(model: ItemEditorModel(image: draft.image, services: services)) { state in
                        notice = state == .notSaved ? "draft saved" : state.label
                        if state.completed { onUploaded() }
                    }
                }
            }
            .task(id: notice) {
                if notice != nil { try? await Task.sleep(for: .seconds(3)); if !Task.isCancelled { notice = nil } }
            }
            .alert("camera access is off", isPresented: $cameraDenied) {
                Button("open settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                Button("cancel", role: .cancel) {}
            } message: { Text("allow camera access in settings, or choose a photo from your library.") }
            .onChange(of: photo) { _, newValue in
                guard let newValue else { return }
                processing = true; error = nil
                Task {
                    do {
                        guard let data = try await newValue.loadTransferable(type: Data.self) else { throw ScanError.invalidImage }
                        let image = try await services.images.jpeg(data, maxEdge: 1600, quality: 0.85)
                        draft = PhotoDraft(image: image.data)
                        services.analytics.track(.photoSelected(.library))
                    } catch { self.error = "couldn’t open this photo. try another." }
                    processing = false; photo = nil
                }
            }
            .task { services.analytics.track(.screen(.capture)); await services.refreshCredentials() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await services.refreshCredentials() } } }
        }
    }
    private func prepare(_ data: Data) {
        processing = true; error = nil
        Task {
            do {
                draft = PhotoDraft(image: try await services.images.jpeg(data, maxEdge: 1600, quality: 0.85).data)
                services.analytics.track(.photoSelected(.camera))
            }
            catch { self.error = ScanError.invalidImage.localizedDescription }
            processing = false
        }
    }
}

// UIImage is immutable here; encoding is dispatched off the UI actor.
private final class CapturedPhoto: @unchecked Sendable {
    let image: UIImage
    init(_ image: UIImage) { self.image = image }
    func data() -> Data? { image.jpegData(compressionQuality: 0.95) }
}

struct CameraPicker: UIViewControllerRepresentable {
    var onPhoto: @MainActor (Data?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onPhoto: onPhoto) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onPhoto: @MainActor (Data?) -> Void
        init(onPhoto: @escaping @MainActor (Data?) -> Void) { self.onPhoto = onPhoto }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onPhoto(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard let image = info[.originalImage] as? UIImage else { onPhoto(nil); return }
            let captured = CapturedPhoto(image)
            Task { @MainActor in
                let data = await Task.detached(priority: .userInitiated) { captured.data() }.value
                onPhoto(data)
            }
        }
    }
}
