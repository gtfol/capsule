import Foundation
import SwiftUI

@MainActor final class OutfitLibraryModel: ObservableObject {
    @Published private(set) var items: [RemoteOutfit] = []
    @Published private(set) var photoReloadID = UUID()
    @Published private(set) var loading = false
    @Published var error: String?
    @Published private(set) var reconnect = false
    func refresh(client: any OutfitServing) async {
        guard !loading else { return }
        loading = true; error = nil; reconnect = false
        defer { loading = false }
        do {
            var cursor: Int64 = 0, records: [String: RemoteOutfit] = [:]
            while true {
                let page = try await client.page(cursor: cursor)
                try Task.checkCancellation()
                for outfit in page.outfits { records[outfit.id] = outfit }
                guard page.hasMore else { break }
                guard page.cursor > cursor else { throw OutfitError.unavailable }
                cursor = page.cursor
            }
            items = records.values.sorted { $0.createdAt > $1.createdAt }
            photoReloadID = UUID()
        } catch is CancellationError {} catch { reconnect = error as? OutfitError == .reconnect; self.error = error.localizedDescription }
    }
}

@MainActor final class OutfitBuilderModel: ObservableObject {
    @Published var name = "outfit"
    @Published var notes = ""
    @Published var selected: Set<String> = []
    @Published var photo: Data?
    @Published var importingPhoto = false
    @Published private(set) var pieces: [RemoteWardrobeItem] = []
    @Published private(set) var config: OutfitConfig?
    @Published private(set) var loading = false
    @Published private(set) var rendering = false
    @Published private(set) var pendingKey: String?
    @Published private(set) var result: RemoteOutfit?
    @Published var error: String?
    let client: any OutfitServing
    let wardrobe: any WardrobeServing
    let userID: String
    let photos: any ModelPhotoStoring
    let images: any ImageProcessing
    private let defaults: UserDefaults
    private var pendingMutation: WardrobeMutation?
    private var preference: String { "capsule.outfit-render.\(userID)" }
    var canRender: Bool { !loading && !rendering && !importingPhoto && pendingKey == nil && photo != nil && !selected.isEmpty && selected.count <= 6 && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && config?.enabled == true && config?.hasSavedKey == true }
    init(client: any OutfitServing, wardrobe: any WardrobeServing, userID: String, photos: any ModelPhotoStoring, images: any ImageProcessing, defaults: UserDefaults = .standard) {
        self.client = client; self.wardrobe = wardrobe; self.userID = userID; self.photos = photos; self.images = images; self.defaults = defaults
        pendingKey = defaults.string(forKey: preference)
    }
    func load() async {
        guard !loading, !rendering, !importingPhoto else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            photo = try await photos.load(userID: userID)
            config = try await client.config()
            var cursor: Int64 = 0, values: [String: RemoteWardrobeItem] = [:]
            while true {
                let page = try await wardrobe.page(cursor: cursor)
                try Task.checkCancellation()
                for piece in page.items { values[piece.id] = piece }
                guard page.hasMore else { break }
                guard page.cursor > cursor else { throw OutfitError.unavailable }
                cursor = page.cursor
            }
            pieces = values.values.sorted { $0.createdAt > $1.createdAt }
            selected.formIntersection(Set(pieces.map(\.id)))
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }
    func toggle(_ piece: RemoteWardrobeItem) {
        guard !rendering, pendingKey == nil else { return }
        if selected.contains(piece.id) { selected.remove(piece.id) }
        else if selected.count < 6 { selected.insert(piece.id) }
    }
    func setPhoto(_ original: Data?) async {
        guard !rendering, pendingKey == nil else { return }
        importingPhoto = true; error = nil
        defer { importingPhoto = false }
        do {
            let prepared: Data?
            if let original { prepared = try await images.jpeg(original, maxEdge: 1200, quality: 0.82).data }
            else { prepared = nil }
            try await photos.save(prepared, userID: userID)
            photo = prepared
        } catch { self.error = "couldn’t save this photo. try another." }
    }
    func render() async {
        guard canRender, let photo else { return }
        rendering = true; error = nil
        var received = false
        defer { rendering = false }
        do {
            var images: [(RemoteWardrobeItem, Data)] = []
            for item in pieces.filter({ selected.contains($0.id) }) {
                images.append((item, try await wardrobe.photo(item: item, view: item.primaryView)))
            }
            let body = try await OutfitPayloadBuilder(images: self.images).prepare(name: name, photo: photo, pieces: images, notes: notes)
            let mutation = WardrobeMutation(body: body)
            pendingMutation = mutation
            pendingKey = mutation.key
            // A small account-scoped receipt survives an app restart. It contains
            // no photos or credentials and is never an offline upload queue.
            defaults.set(mutation.key, forKey: preference)
            let receipt = try await client.render(mutation: mutation)
            received = true
            try await accept(receipt)
        } catch { handle(error, checking: received) }
    }
    func checkRender() async {
        guard !rendering, let key = pendingKey else { return }
        rendering = true; error = nil
        defer { rendering = false }
        do {
            let receipt: OutfitRenderReceipt
            do { receipt = try await client.renderStatus(key: key) }
            catch OutfitError.missing {
                // A request that never reached the server can reuse its exact body.
                guard let pendingMutation else { clearPending(); throw OutfitError.renderFailed("the render didn’t start. select your pieces and try again.") }
                receipt = try await client.render(mutation: pendingMutation)
            }
            try await accept(receipt)
        } catch { handle(error, checking: true) }
    }
    private func accept(_ receipt: OutfitRenderReceipt) async throws {
        if receipt.state == "pending" { return }
        guard let id = receipt.id else { throw OutfitError.unavailable }
        do { result = try await client.item(id: id) }
        catch OutfitError.missing { clearPending(); throw OutfitError.missing }
        clearPending()
    }
    private func clearPending() { pendingKey = nil; pendingMutation = nil; defaults.removeObject(forKey: preference) }
    private func handle(_ error: Error, checking: Bool = false) {
        switch error as? OutfitError {
        case .renderFailed, .interrupted:
            clearPending()
        case .keyRequired, .invalid, .rateLimited, .conflict:
            if !checking { clearPending() }
        default: break // Network/auth failures keep the request identity for recovery.
        }
        self.error = (error as? LocalizedError)?.errorDescription ?? "couldn’t complete this render. check its status before trying again."
    }
}

@MainActor final class OutfitDetailModel: ObservableObject {
    @Published private(set) var outfit: RemoteOutfit
    @Published var name: String
    @Published private(set) var busy = false
    @Published var error: String?
    @Published private(set) var removed = false
    @Published private(set) var conflict = false
    private var pending: (method: String, mutation: WardrobeMutation)?
    let client: any OutfitServing
    var changed: Bool { name != outfit.name }
    init(outfit: RemoteOutfit, client: any OutfitServing) { self.outfit = outfit; self.name = outfit.name; self.client = client }
    func reload() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do { outfit = try await client.item(id: outfit.id); name = outfit.name; pending = nil; conflict = false; error = nil }
        catch { self.error = error.localizedDescription }
    }
    func save(remove: Bool = false) async {
        guard !busy, !conflict else { return }
        busy = true; error = nil; defer { busy = false }
        do {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard remove || (!trimmed.isEmpty && trimmed.count <= 500) else { throw OutfitError.invalid }
            var values: [String: Any] = ["expectedRevision": outfit.revision]
            if !remove { values["name"] = trimmed }
            let body = try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])
            let method = remove ? "DELETE" : "PATCH"
            if pending?.method != method || pending?.mutation.body != body { pending = (method, WardrobeMutation(body: body)) }
            if remove { try await client.remove(id: outfit.id, mutation: pending!.mutation); removed = true }
            else { try await client.update(id: outfit.id, mutation: pending!.mutation); outfit = try await client.item(id: outfit.id); name = outfit.name }
            pending = nil
        } catch { conflict = error as? OutfitError == .conflict; self.error = error.localizedDescription }
    }
}
