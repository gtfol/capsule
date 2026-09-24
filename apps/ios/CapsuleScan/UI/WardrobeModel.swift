import SwiftUI

@MainActor final class WardrobeModel: ObservableObject {
    @Published private(set) var items: [RemoteWardrobeItem] = []
    @Published private(set) var loading = false
    @Published private(set) var loaded = false
    @Published private(set) var photoReloadID = UUID()
    @Published private(set) var error: String?
    @Published private(set) var needsSignIn = false
    private var generation = UUID()
    func load(client: any WardrobeServing) async {
        let current = UUID(); generation = current
        loading = true; error = nil; needsSignIn = false
        defer { if generation == current { loading = false } }
        do {
            var records: [String: RemoteWardrobeItem] = [:]
            var cursor: Int64 = 0
            while true {
                try Task.checkCancellation()
                let page = try await client.page(cursor: cursor)
                for item in page.items { records[item.id] = item }
                if !page.hasMore { break }
                guard page.cursor > cursor else { throw WardrobeError.unavailable }
                cursor = page.cursor
            }
            try Task.checkCancellation()
            guard generation == current else { return }
            items = records.values.sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt > $1.createdAt }
            photoReloadID = UUID()
            loaded = true
        } catch is CancellationError { }
        catch {
            guard generation == current, !Task.isCancelled else { return }
            needsSignIn = error as? WardrobeError == .reconnect
            self.error = (error as? WardrobeError)?.localizedDescription ?? "couldn’t load your wardrobe. try again."
            if needsSignIn { items = []; loaded = false }
        }
    }
}

@MainActor final class WardrobeDetailModel: ObservableObject {
    @Published private(set) var item: RemoteWardrobeItem
    @Published var edit: WardrobeEdit
    @Published var priceText: String
    @Published private(set) var previews: [GarmentView: Data] = [:]
    @Published private(set) var busy = false
    @Published private(set) var processing = false
    @Published private(set) var saving = false
    @Published private(set) var error: String?
    @Published private(set) var conflict = false
    @Published private(set) var needsSignIn = false
    private var pending: WardrobeMutation?
    private var deletion: WardrobeMutation?
    private var priceCheck: WardrobeMutation?
    private var movement: WardrobeMutation?
    let collection: CapsuleCollection
    private let client: any WardrobeServing
    private let images: any ImageProcessing
    private let isolation: any ImageIsolating
    private var originals: [GarmentView: Data] = [:]
    private var remoteOriginals: Set<GarmentView> = []
    init(item: RemoteWardrobeItem, client: any WardrobeServing, images: any ImageProcessing, isolation: any ImageIsolating, collection: CapsuleCollection = .wardrobe) {
        self.collection = collection
        self.item = item; edit = WardrobeEdit(item: item); priceText = Price.display(item.fields.price)
        self.client = client; self.images = images; self.isolation = isolation
    }
    var hasChanges: Bool { edit != WardrobeEdit(item: item) || priceText != Price.display(item.fields.price) }
    func replacePhoto(_ data: Data, view: GarmentView) async {
        guard !processing, !busy else { return }
        processing = true; error = nil
        defer { processing = false }
        do {
            let photo = try await prepare(data)
            originals[view] = photo; remoteOriginals.remove(view)
            previews[view] = photo
            edit.photos[view] = PhotoEncoding.dataURL(photo)
        } catch { self.error = "couldn’t open this photo. try another." }
    }
    func photoFailed() { error = "couldn’t open this photo. try another." }
    private func prepare(_ data: Data) async throws -> Data {
        for edge in [1600, 1280, 1024, 800, 640, 400] {
            let photo = try await images.preservingTransparency(data, maxEdge: edge, quality: 0.75).data
            if photo.count <= 600_000 { return photo }
        }
        throw ScanError.imageTooLarge
    }
    func removePhoto(_ view: GarmentView) {
        guard !processing, !busy else { return }
        previews[view] = nil; originals[view] = nil; remoteOriginals.remove(view); edit.photos[view] = ""
    }
    func restorePhoto(_ view: GarmentView) {
        guard let data = originals[view], !busy, !processing else { return }
        previews[view] = data
        edit.photos[view] = remoteOriginals.contains(view) ? nil : PhotoEncoding.dataURL(data)
    }
    func hasOriginal(_ view: GarmentView) -> Bool { originals[view] != nil && originals[view] != previews[view] }
    func cutout(_ view: GarmentView) async {
        guard !processing, !busy else { return }
        processing = true; error = nil
        defer { processing = false }
        do {
            let source: Data
            if let preview = previews[view] { source = preview } else { source = try await client.photo(item: item, view: view) }
            let cutout = try await isolation.isolate(source)
            let photo = try await prepare(cutout.data)
            if edit.photos[view] == nil { remoteOriginals.insert(view) } else { remoteOriginals.remove(view) }
            originals[view] = source; previews[view] = photo
            edit.photos[view] = PhotoEncoding.dataURL(photo)
        } catch { self.error = "couldn’t remove the background. the photo is unchanged." }
    }
    func save() async -> Bool {
        guard !busy, !processing else { return false }
        busy = true; saving = true; error = nil; conflict = false; needsSignIn = false
        defer { busy = false; saving = false }
        do {
            var copy = edit; copy.fields.price = try Price.canonical(priceText)
            let body = try copy.encoded(revision: item.revision, collection: collection)
            if pending?.body != body { pending = WardrobeMutation(body: body) }
            do { try await submit() }
            catch ScanError.idempotencyConflict {
                pending!.key = UUID().uuidString
                try await submit()
            }
            return true
        } catch { handle(error); return false }
    }
    private func submit() async throws {
        if item.revision == 0 { _ = try await client.create(mutation: pending!) }
        else { try await client.update(id: item.id, mutation: pending!) }
    }
    func checkPrice(url: String) async {
        guard !busy, !processing, !hasChanges, item.revision > 0 else { return }
        busy = true; error = nil; conflict = false; needsSignIn = false
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["expectedRevision": item.revision, "url": url], options: [.sortedKeys])
            if priceCheck?.body != body { priceCheck = WardrobeMutation(body: body) }
            let fetched: Bool
            do { fetched = try await client.checkPrice(id: item.id, mutation: priceCheck!) }
            catch ScanError.idempotencyConflict {
                priceCheck!.key = UUID().uuidString
                fetched = try await client.checkPrice(id: item.id, mutation: priceCheck!)
            }
            let fresh = try await client.item(id: item.id)
            apply(fresh); priceCheck = nil
            if !fetched { error = "couldn’t check this link. your price history is unchanged." }
        } catch { handle(error) }
    }
    func purchase() async -> Bool {
        guard !busy, !processing, !hasChanges, item.revision > 0 else { return false }
        busy = true; error = nil; conflict = false; needsSignIn = false
        defer { busy = false }
        do {
            if movement == nil { movement = WardrobeMutation(body: try JSONEncoder().encode(["expectedRevision": item.revision])) }
            do { _ = try await client.purchase(id: item.id, mutation: movement!) }
            catch ScanError.idempotencyConflict {
                movement!.key = UUID().uuidString
                _ = try await client.purchase(id: item.id, mutation: movement!)
            }
            return true
        } catch { handle(error); return false }
    }
    private func apply(_ fresh: RemoteWardrobeItem) {
        item = fresh; edit = WardrobeEdit(item: fresh); priceText = Price.display(fresh.fields.price)
        previews = [:]; originals = [:]; remoteOriginals = []; pending = nil; deletion = nil; movement = nil; conflict = false
    }
    func reload() async {
        guard !busy, !processing else { return }
        busy = true; error = nil; needsSignIn = false
        defer { busy = false }
        do {
            let fresh = try await client.item(id: item.id)
            apply(fresh); priceCheck = nil
        } catch { handle(error) }
    }
    func remove() async -> Bool {
        guard !busy, !processing else { return false }
        busy = true; error = nil; conflict = false; needsSignIn = false
        defer { busy = false }
        do {
            if deletion == nil { deletion = WardrobeMutation(body: try JSONEncoder().encode(["expectedRevision": item.revision])) }
            do { try await client.remove(id: item.id, mutation: deletion!) }
            catch ScanError.idempotencyConflict {
                deletion!.key = UUID().uuidString
                try await client.remove(id: item.id, mutation: deletion!)
            }
            return true
        } catch { handle(error); return false }
    }
    private func handle(_ error: Error) {
        needsSignIn = error as? WardrobeError == .reconnect
        conflict = error as? WardrobeError == .conflict
        self.error = (error as? WardrobeError)?.localizedDescription ?? (error as? ScanError)?.localizedDescription ?? "couldn’t save this change. try again."
    }
}
