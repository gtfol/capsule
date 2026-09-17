import SwiftUI

@MainActor final class ItemEditorModel: ObservableObject {
    enum Field: Hashable { case name, brand, category, color }
    @Published var fields: ItemFields
    @Published var priceText: String
    @Published var image: Data?
    @Published var record: ItemRecord?
    @Published var sendToCapsule: Bool
    @Published var extracting = false
    @Published var saving = false
    @Published var message: String?
    @Published var error: String?
    private var edited: Set<Field> = []
    private var extractionTask: Task<Void, Never>?
    private var started = false
    private let services: AppServices

    init(image: Data? = nil, record: ItemRecord? = nil, services: AppServices) {
        self.image = image; self.record = record; self.services = services
        fields = record?.fields ?? ItemFields()
        priceText = Price.display(record?.fields.price)
        sendToCapsule = services.connected && record?.capsuleSaveState.completed != true
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
    }
    func stopExtraction() { extractionTask?.cancel(); extracting = false }

    func save() async -> Bool {
        guard !saving else { return false }
        saving = true; error = nil; message = nil
        defer { saving = false }
        var newImageReference: String?
        do {
            var reviewed = fields
            reviewed.price = try Price.canonical(priceText)
            let willSend = sendToCapsule && services.connected && record?.capsuleSaveState.completed != true
            reviewed = try reviewed.validated(requireName: willSend)
            stopExtraction() // Never let a late response overwrite the reviewed values.
            var item: ItemRecord
            if var existing = record {
                existing.edit(reviewed)
                item = existing
            } else {
                guard let image else { throw ScanError.invalidImage }
                let reference = try await services.media.write(image, extension: "jpg")
                newImageReference = reference
                item = ItemRecord(localImageReference: reference, fields: reviewed)
            }
            let previousRequest = record?.capsuleRequestReference
            try services.items.save(item)
            record = item
            newImageReference = nil
            if let previousRequest, previousRequest != item.capsuleRequestReference { await services.media.remove(previousRequest) }
            if willSend {
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
