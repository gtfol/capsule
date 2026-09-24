import SwiftUI

@MainActor final class ItemEditorModel: ObservableObject {
    enum Field: Hashable { case name, brand, category, color }
    @Published var fields: ItemFields
    @Published var priceText: String
    @Published var image: Data?
    @Published var record: ItemRecord?
    @Published var extracting = false
    @Published private(set) var isolating = false
    @Published private(set) var usingCutout = false
    @Published private(set) var cutout: Data?
    @Published private(set) var isolationMessage: String?
    @Published var saving = false
    @Published var message: String?
    @Published var error: String?
    private var edited: Set<Field> = []
    private var extractionTask: Task<Void, Never>?
    private var isolationTask: Task<Void, Never>?
    private var originalImage: Data?
    private var started = false
    private let services: AppServices

    init(image: Data? = nil, record: ItemRecord? = nil, services: AppServices) {
        self.image = image; self.originalImage = image; self.record = record; self.services = services
        fields = record?.fields ?? ItemFields()
        priceText = Price.display(record?.fields.price)
    }
    var hasUnsavedChanges: Bool {
        guard let record else { return true }
        var current = fields
        do {
            current.price = try Price.canonical(priceText)
            return try current.validated() != record.fields
        } catch { return true }
    }
    func touched(_ field: Field) { edited.insert(field) }
    func start() async {
        guard !started else { return }
        started = true
        if let record {
            do { image = try await services.media.read(record.localImageReference) }
            catch { self.error = "photo unavailable on this iphone." }
            return
        }
        guard let image else { return }
        isolating = true
        isolationTask = Task {
            do {
                let result = try await services.isolation.isolate(image)
                guard !Task.isCancelled else { return }
                cutout = result.data
                self.image = result.data
                usingCutout = true
            } catch {
                guard !Task.isCancelled else { return }
                isolationMessage = "couldn’t isolate this item. using the original photo."
            }
            isolating = false
        }
        extracting = true
        let extractor = services.extractor()
        extractionTask = Task {
            var draft: ExtractedDraft
            do { draft = try await extractor.extract(image: image) }
            catch {
                guard !Task.isCancelled else { return }
                draft = (try? await OnDeviceItemExtractor().extract(image: image)) ?? ExtractedDraft()
                if !Task.isCancelled { message = "some details couldn’t be read. enter them below." }
            }
            guard !Task.isCancelled else { return }
            if !edited.contains(.name), let name = draft.name { fields.name = name }
            if !edited.contains(.brand), let brand = draft.brand { fields.brand = brand }
            if !edited.contains(.category) { fields.category = draft.validatedCategory }
            if !edited.contains(.color), let color = draft.color { fields.color = color }
            extracting = false
        }
        await extractionTask?.value
        await isolationTask?.value
    }
    func selectCutout(_ enabled: Bool) {
        guard !saving, record == nil else { return }
        if enabled {
            guard let cutout else { return }
            image = cutout
        } else {
            isolationTask?.cancel(); isolating = false
            image = originalImage
        }
        usingCutout = enabled
    }
    func stopExtraction() {
        extractionTask?.cancel(); extracting = false
        isolationTask?.cancel(); isolating = false
    }

    func saveDraft() async -> Bool { await persist(send: false) }
    func save() async -> Bool { await persist(send: true) }
    private func persist(send: Bool) async -> Bool {
        guard !saving else { return false }
        if record?.capsuleSaveState.completed == true { return true }
        saving = true; error = nil; message = nil
        defer { saving = false }
        var newImageReference: String?
        let accountID = services.user?.id
        do {
            var reviewed = fields
            reviewed.price = try Price.canonical(priceText)
            if let owner = record?.capsuleUserID, owner != services.user?.id { throw ScanError.wrongAccount }
            if send && !services.connected { throw ScanError.notConnected }
            reviewed = try reviewed.validated(requireName: send)
            stopExtraction() // Never let a late response overwrite the reviewed values.
            var item: ItemRecord
            if var existing = record {
                existing.edit(reviewed)
                item = existing
            } else {
                guard let image else { throw ScanError.invalidImage }
                let reference = try await services.media.write(image, extension: PhotoEncoding.suffix(image))
                newImageReference = reference
                item = ItemRecord(localImageReference: reference, fields: reviewed)
            }
            item.capsuleUserID = item.capsuleUserID ?? accountID
            let previousRequest = record?.capsuleRequestReference
            try services.items.save(item)
            record = item
            newImageReference = nil
            if let previousRequest, previousRequest != item.capsuleRequestReference { await services.media.remove(previousRequest) }
            if send {
                do { try await services.send(id: item.id) }
                catch {
                    record = try services.items.record(id: item.id)
                    self.error = (error as? ScanError ?? .unavailable).localizedDescription
                    return false
                }
                record = try services.items.record(id: item.id)
            }
            return true
        } catch {
            if let newImageReference { await services.media.remove(newImageReference) }
            self.error = (error as? ScanError ?? .storage).localizedDescription
            return false
        }
    }
}
