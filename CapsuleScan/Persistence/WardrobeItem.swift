import Foundation
import SwiftData

@Model final class WardrobeItem {
    @Attribute(.unique) var id: UUID
    var createdAt: Date
    var updatedAt: Date
    var localImageReference: String
    var name: String
    var brand: String
    var category: String?
    var color: String
    var size: String
    var price: String?
    var currency: String
    var capsuleSaveState: String
    var capsuleIdempotencyKey: String?
    var capsuleRemoteItemID: String?
    var lastCapsuleError: String?
    var capsuleRequestReference: String?

    init(_ record: ItemRecord) {
        id = record.id; createdAt = record.createdAt; updatedAt = record.updatedAt
        localImageReference = record.localImageReference
        name = record.fields.name; brand = record.fields.brand; category = record.fields.category?.rawValue
        color = record.fields.color; size = record.fields.size; price = record.fields.price; currency = record.fields.currency
        capsuleSaveState = record.capsuleSaveState.rawValue; capsuleIdempotencyKey = record.capsuleIdempotencyKey
        capsuleRemoteItemID = record.capsuleRemoteItemID; lastCapsuleError = record.lastCapsuleError
        capsuleRequestReference = record.capsuleRequestReference
    }
    var record: ItemRecord {
        ItemRecord(id: id, createdAt: createdAt, updatedAt: updatedAt, localImageReference: localImageReference,
                   fields: ItemFields(name: name, brand: brand, category: GarmentCategory.validated(category), color: color, size: size, price: price, currency: currency),
                   capsuleSaveState: CapsuleSaveState(rawValue: capsuleSaveState) ?? .notSaved,
                   capsuleIdempotencyKey: capsuleIdempotencyKey, capsuleRemoteItemID: capsuleRemoteItemID,
                   lastCapsuleError: lastCapsuleError, capsuleRequestReference: capsuleRequestReference)
    }
    func apply(_ record: ItemRecord) {
        updatedAt = record.updatedAt; localImageReference = record.localImageReference
        name = record.fields.name; brand = record.fields.brand; category = record.fields.category?.rawValue
        color = record.fields.color; size = record.fields.size; price = record.fields.price; currency = record.fields.currency
        capsuleSaveState = record.capsuleSaveState.rawValue; capsuleIdempotencyKey = record.capsuleIdempotencyKey
        capsuleRemoteItemID = record.capsuleRemoteItemID; lastCapsuleError = record.lastCapsuleError
        capsuleRequestReference = record.capsuleRequestReference
    }
}

@MainActor final class SwiftDataItemStore: ItemStoring {
    static func makeContainer(in directory: URL) throws -> ModelContainer {
        // Provision the directory before Core Data opens its SQLite files on first launch.
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let configuration = ModelConfiguration(url: directory.appendingPathComponent("default.store"), cloudKitDatabase: .none)
        return try ModelContainer(for: WardrobeItem.self, configurations: configuration)
    }
    let context: ModelContext
    init(context: ModelContext) { self.context = context; context.autosaveEnabled = false }
    private func model(id: UUID) throws -> WardrobeItem? {
        let query = FetchDescriptor<WardrobeItem>(predicate: #Predicate { $0.id == id })
        return try context.fetch(query).first
    }
    func record(id: UUID) throws -> ItemRecord {
        guard let item = try model(id: id) else { throw ScanError.storage }
        return item.record
    }
    func save(_ record: ItemRecord) throws {
        do {
            if let item = try model(id: record.id) { item.apply(record) }
            else { context.insert(WardrobeItem(record)) }
            try context.save()
        } catch { context.rollback(); throw ScanError.storage }
    }
    func recoverInterruptedSaves() throws {
        for item in try context.fetch(FetchDescriptor<WardrobeItem>()) where item.capsuleSaveState == CapsuleSaveState.saving.rawValue {
            item.capsuleSaveState = CapsuleSaveState.failed.rawValue
            item.lastCapsuleError = "save interrupted. retry to confirm it with capsule."
        }
        do { try context.save() } catch { context.rollback(); throw ScanError.storage }
    }
}
