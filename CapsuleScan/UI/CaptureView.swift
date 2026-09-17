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
                    Text("sign in to add items to your capsule wardrobe.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    SignInButton().buttonStyle(.borderedProminent).controlSize(.large)
                    if let message = services.connectionMessage { Text(message).font(.footnote).foregroundStyle(.secondary) }
                } else {
                Image(systemName: "tshirt").font(.system(size: 72, weight: .ultraLight)).foregroundStyle(.secondary).accessibilityHidden(true)
                VStack(spacing: 8) {
                    Text("add an item").font(.title2)
                    Text("keep the whole item in the frame.").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                VStack(spacing: 14) {
                    Button {
                        Task {
                            if await camera.requestAccess() { showingCamera = true }
                            else { cameraDenied = true }
                        }
                    } label: { Label("take a photo", systemImage: "camera").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                    .disabled(processing || !UIImagePickerController.isSourceTypeAvailable(.camera))
                    PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .current) {
                        Label("choose a photo", systemImage: "photo").frame(maxWidth: .infinity)
                    }.buttonStyle(.bordered).disabled(processing)
                    if !UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Text("camera unavailable. choose a photo instead.").font(.caption).foregroundStyle(.secondary)
                    }
                }.controlSize(.large)
                if processing { ProgressView("preparing photo…").font(.footnote) }
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary).accessibilityAddTraits(.updatesFrequently) }
                if let notice { Text(notice).font(.footnote).foregroundStyle(.secondary).accessibilityAddTraits(.updatesFrequently) }
                Link("open wardrobe", destination: URL(string: "https://capsule.gtfol.dev/?view=wardrobe")!).font(.footnote)
                }
                Spacer()
            }
            .padding(24)
            .navigationTitle("capsule scan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { NavigationLink { DraftsView() } label: { Image(systemName: "tray") }.accessibilityLabel("drafts") }
                ToolbarItem(placement: .topBarTrailing) { NavigationLink { SettingsView() } label: { Image(systemName: "gearshape") }.accessibilityLabel("settings") }
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
                    } catch { self.error = "couldn’t open this photo. try another." }
                    processing = false; photo = nil
                }
            }
            .task { await services.refreshCredentials() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await services.refreshCredentials() } } }
        }
    }
    private func prepare(_ data: Data) {
        processing = true; error = nil
        Task {
            do { draft = PhotoDraft(image: try await services.images.jpeg(data, maxEdge: 1600, quality: 0.85).data) }
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
