import SwiftUI

@MainActor final class WardrobeModel: ObservableObject {
    @Published private(set) var items: [RemoteWardrobeItem] = []
    @Published private(set) var loading = false
    @Published private(set) var loaded = false
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
    @Published private(set) var error: String?
    @Published private(set) var conflict = false
    @Published private(set) var needsSignIn = false
    private var pending: WardrobeMutation?
    private var deletion: WardrobeMutation?
    private let client: any WardrobeServing
    private let images: any ImageProcessing
    private let isolation: any ImageIsolating
    private var originals: [GarmentView: Data] = [:]
    private var remoteOriginals: Set<GarmentView> = []
    init(item: RemoteWardrobeItem, client: any WardrobeServing, images: any ImageProcessing, isolation: any ImageIsolating) {
        self.item = item; edit = WardrobeEdit(item: item); priceText = Price.display(item.fields.price)
        self.client = client; self.images = images; self.isolation = isolation
    }
    var hasChanges: Bool { edit != WardrobeEdit(item: item) || priceText != Price.display(item.fields.price) }
    func replacePhoto(_ data: Data, view: GarmentView) async {
        guard !processing, !busy else { return }
        processing = true; error = nil
        defer { processing = false }
        do {
            let jpeg = try await prepare(data)
            originals[view] = jpeg; remoteOriginals.remove(view)
            previews[view] = jpeg
            edit.photos[view] = "data:image/jpeg;base64," + jpeg.base64EncodedString()
        } catch { self.error = "couldn’t open this photo. try another." }
    }
    func photoFailed() { error = "couldn’t open this photo. try another." }
    private func prepare(_ data: Data) async throws -> Data {
        for edge in [1600, 1280, 1024, 800] {
            let jpeg = try await images.jpeg(data, maxEdge: edge, quality: 0.75).data
            if jpeg.count <= 600_000 { return jpeg }
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
        edit.photos[view] = remoteOriginals.contains(view) ? nil : "data:image/jpeg;base64," + data.base64EncodedString()
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
            let jpeg = try await prepare(cutout.data)
            if edit.photos[view] == nil { remoteOriginals.insert(view) } else { remoteOriginals.remove(view) }
            originals[view] = source; previews[view] = jpeg
            edit.photos[view] = "data:image/jpeg;base64," + jpeg.base64EncodedString()
        } catch { self.error = "couldn’t remove the background. the photo is unchanged." }
    }
    func save() async -> Bool {
        guard !busy, !processing else { return false }
        busy = true; error = nil; conflict = false; needsSignIn = false
        defer { busy = false }
        do {
            var copy = edit; copy.fields.price = try Price.canonical(priceText)
            let body = try copy.encoded(revision: item.revision)
            if pending?.body != body { pending = WardrobeMutation(body: body) }
            do { try await client.update(id: item.id, mutation: pending!) }
            catch ScanError.idempotencyConflict {
                pending!.key = UUID().uuidString
                try await client.update(id: item.id, mutation: pending!)
            }
            return true
        } catch { handle(error); return false }
    }
    func reload() async {
        guard !busy, !processing else { return }
        busy = true; error = nil; needsSignIn = false
        defer { busy = false }
        do {
            let fresh = try await client.item(id: item.id)
            item = fresh; edit = WardrobeEdit(item: fresh); priceText = Price.display(fresh.fields.price)
            previews = [:]; originals = [:]; remoteOriginals = []; pending = nil; deletion = nil; conflict = false
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
