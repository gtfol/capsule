import SwiftUI

@MainActor struct WardrobeView: View {
    @EnvironmentObject private var services: AppServices
    @Environment(\.scenePhase) private var scenePhase
    @State private var capture = false
    var body: some View {
        NavigationStack {
            Group {
                if !services.credentialsReady { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
                else if let client = services.wardrobe, let user = services.user {
                    WardrobeGrid(client: client, add: { capture = true }).id(user.id)
                } else {
                    VStack(spacing: 20) {
                        Text("capsule scan").font(CapsuleStyle.heading)
                        SignInButton().capsulePrimaryAction()
                        if let message = services.connectionMessage { Text(message).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
                    }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .capsuleScreen()
            .navigationTitle("wardrobe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { Text("wardrobe").font(CapsuleStyle.heading) }
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink { SettingsView() } label: { Image(systemName: "gearshape").font(.system(size: 15)).frame(width: 44, height: 44) }.accessibilityLabel("settings")
                }.quietBackground()
                ToolbarItem(placement: .topBarTrailing) {
                    Button { capture = true } label: { Image(systemName: "plus").font(.system(size: 16)).frame(width: 44, height: 44) }.accessibilityLabel("add to wardrobe").disabled(!services.connected)
                }.quietBackground()
            }
            .sheet(isPresented: $capture) {
                CaptureView(inWardrobe: true, onUploaded: { capture = false })
            }
            .task { await services.refreshCredentials() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await services.refreshCredentials(); services.wardrobeReloadID = UUID() } }
            }
        }
    }
}

@MainActor private struct WardrobeGrid: View {
    @EnvironmentObject private var services: AppServices
    @StateObject private var model = WardrobeModel()
    @State private var category: GarmentCategory?
    @State private var selected: RemoteWardrobeItem?
    let client: any WardrobeServing
    let add: () -> Void
    private var filtered: [RemoteWardrobeItem] { model.items.filter { category == nil || $0.category == category } }
    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 24) {
                    categoryButton("all", value: nil)
                    ForEach(GarmentCategory.allCases) { categoryButton($0.rawValue, value: $0) }
                }.padding(.horizontal, 20)
            }
            if let error = model.error {
                VStack(spacing: 8) {
                    Text(error).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    if model.needsSignIn { SignInButton() }
                    else { Button("try again") { Task { await model.load(client: client) } }.font(CapsuleStyle.caption) }
                }.padding(20)
            }
            ScrollView {
                if model.loading && !model.loaded { ProgressView().padding(.top, 48) }
                else if model.loaded && filtered.isEmpty {
                    VStack(spacing: 12) {
                        Text(category == nil ? "your wardrobe is empty" : "no \(category!.rawValue) yet").font(CapsuleStyle.heading)
                        Button("add an item", action: add).font(CapsuleStyle.body).frame(minHeight: 44)
                    }.frame(maxWidth: .infinity).padding(.top, 48)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 16)], alignment: .leading, spacing: 24) {
                        ForEach(filtered) { item in
                            Button { selected = item } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    WardrobePhoto(item: item, view: item.primaryView, client: client)
                                        .aspectRatio(3 / 4, contentMode: .fit)
                                    Text(item.name).font(CapsuleStyle.body).lineLimit(2)
                                    Text(item.brand.isEmpty ? item.category.rawValue : item.brand).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).lineLimit(1)
                                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }.padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 32)
                }
            }
            .refreshable { await model.load(client: client) }
        }
        .task(id: services.wardrobeReloadID) { await model.load(client: client) }
        .sheet(item: $selected, onDismiss: { services.wardrobeReloadID = UUID() }) { item in
            NavigationStack {
                WardrobeDetailView(model: WardrobeDetailModel(item: item, client: client, images: services.images, isolation: services.isolation), client: client)
            }
        }
    }
    private func categoryButton(_ title: String, value: GarmentCategory?) -> some View {
        Button { category = value } label: {
            Text(title).font(CapsuleStyle.caption).foregroundStyle(category == value ? CapsuleStyle.text : CapsuleStyle.secondary).frame(minHeight: 44)
        }.buttonStyle(.plain).accessibilityAddTraits(category == value ? .isSelected : [])
    }
}

// Memory-only, bounded cache; keys include account, revision, and view. No offline library.
actor WardrobePhotoCache {
    static let shared = WardrobePhotoCache()
    private var generation = UUID()
    private var data: [String: Data] = [:]
    private var order: [String] = []
    private var tasks: [String: Task<Data, Error>] = [:]
    func load(key: String, operation: @escaping @Sendable () async throws -> Data) async throws -> Data {
        if let value = data[key] { return value }
        if let task = tasks[key] { return try await task.value }
        let current = generation
        let task = Task { try await operation() }; tasks[key] = task
        defer { if generation == current { tasks[key] = nil } }
        let value = try await task.value
        guard current == generation else { throw CancellationError() }
        data[key] = value; order.append(key)
        while order.count > 32 || data.values.reduce(0, { $0 + $1.count }) > 24_000_000 { data[order.removeFirst()] = nil }
        return value
    }
    func clear() { generation = UUID(); tasks.values.forEach { $0.cancel() }; tasks = [:]; data = [:]; order = [] }
}

@MainActor struct WardrobePhoto: View {
    @EnvironmentObject private var services: AppServices
    let item: RemoteWardrobeItem
    let view: GarmentView
    let client: any WardrobeServing
    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0
    var body: some View {
        ZStack {
            CapsuleStyle.canvas
            if let image { Image(uiImage: image).resizable().scaledToFit().accessibilityLabel("\(item.name), \(view.rawValue)") }
            else if failed {
                Button { attempt += 1 } label: { Image(systemName: "arrow.clockwise").font(.system(size: 16)).frame(width: 44, height: 44) }.accessibilityLabel("reload photo")
            } else if item.hasPhoto(view) { ProgressView().controlSize(.small) }
            else { Text("no photo").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
        }
        .clipped()
        .task(id: "\(services.user?.id ?? ""):\(item.id):\(item.revision):\(view.rawValue):\(attempt)") {
            image = nil; failed = false
            guard item.hasPhoto(view), let userID = services.user?.id else { return }
            let key = "\(userID):\(item.id):\(item.revision):\(view.rawValue)"
            do {
                let data = try await WardrobePhotoCache.shared.load(key: key) { try await client.photo(item: item, view: view) }
                guard !Task.isCancelled, services.user?.id == userID else { return }
                image = UIImage(data: data); failed = image == nil
            } catch { if !Task.isCancelled { failed = true } }
        }
    }
}
