import Foundation

@MainActor protocol ItemStoring: AnyObject {
    func record(id: UUID) throws -> ItemRecord
    func save(_ record: ItemRecord) throws
}

@MainActor final class CapsuleSaveCoordinator {
    private let items: any ItemStoring
    private let media: any MediaStoring
    private let payloads: any PayloadPreparing
    private let destination: any WardrobeDestination
    private var active: Set<UUID> = []

    init(items: any ItemStoring, media: any MediaStoring, payloads: any PayloadPreparing, destination: any WardrobeDestination) {
        self.items = items; self.media = media; self.payloads = payloads; self.destination = destination
    }

    func send(id: UUID) async throws {
        guard !active.contains(id) else { return }
        var record = try items.record(id: id)
        guard !record.capsuleSaveState.completed else { return }
        _ = try record.fields.validated(requireName: true)
        active.insert(id)
        defer { active.remove(id) }
        do {
            let body: Data
            if let reference = record.capsuleRequestReference, record.capsuleIdempotencyKey != nil {
                body = try await media.read(reference)
            } else {
                let image = try await media.read(record.localImageReference)
                body = try await payloads.prepare(fields: record.fields, image: image)
                record.capsuleRequestReference = try await media.write(body, extension: "json")
                record.capsuleIdempotencyKey = UUID().uuidString
            }
            record.capsuleSaveState = .saving
            record.lastCapsuleError = nil
            record.updatedAt = Date()
            try items.save(record) // Commit key AND exact bytes before any network request.
            let receipt: DestinationReceipt
            do {
                receipt = try await destination.save(body: body, idempotencyKey: record.capsuleIdempotencyKey!)
            } catch ScanError.idempotencyConflict {
                record.capsuleIdempotencyKey = UUID().uuidString
                try items.save(record)
                // This is intentionally one retry, never a recursive retry loop.
                receipt = try await destination.save(body: body, idempotencyKey: record.capsuleIdempotencyKey!)
            }
            record.capsuleRemoteItemID = receipt.itemID
            record.capsuleSaveState = receipt.duplicate ? .alreadyExists : .saved
            record.lastCapsuleError = nil
            record.updatedAt = Date()
            try items.save(record)
        } catch {
            let safeError = (error as? ScanError) ?? .storage
            record.capsuleSaveState = .failed
            record.lastCapsuleError = safeError.localizedDescription
            record.updatedAt = Date()
            // If this fails, the pre-request 'saving' checkpoint survives; launch recovery
            // marks it retryable without changing its key/body.
            try items.save(record)
            throw safeError
        }
    }
}
