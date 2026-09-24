import SwiftUI
import ImageIO

// Explicit refreshes are shared by grids, detail sheets, and outfit pickers.
// Normal navigation reuses the same account/revision cache entries.
@MainActor final class PhotoRefreshState: ObservableObject {
    static let shared = PhotoRefreshState()
    @Published private var versions: [String: UUID] = [:]
    func version(account: String, collection: String) -> String { versions["\(account):\(collection)"]?.uuidString ?? "" }
    func refresh(account: String, collection: String) { versions["\(account):\(collection)"] = UUID() }
}

// Memory only. Keep encoded originals for detail previews and decoded thumbnails for scrolling.
// Limit concurrent downloads, share requests, and cancel work once its last viewer leaves.
actor WardrobePhotoCache {
    static let shared = WardrobePhotoCache()
    private struct Flight {
        let id = UUID()
        let operation: @Sendable () async throws -> Data
        var waiters: [UUID: CheckedContinuation<Data, Error>] = [:]
        var task: Task<Void, Never>?
    }
    private var bytes: [String: Data] = [:]
    private var byteOrder: [String] = []
    private var images: [String: CGImage] = [:]
    private var imageOrder: [String] = []
    private var flights: [String: Flight] = [:]
    private var queue: [String] = []
    private var running: Set<UUID> = []
    private var generation = UUID()
    private let concurrency: Int
    private let byteLimit: Int
    private let imageLimit: Int
    init(concurrency: Int = 4, byteLimit: Int = 24_000_000, imageLimit: Int = 48_000_000) {
        self.concurrency = max(1, concurrency); self.byteLimit = byteLimit; self.imageLimit = imageLimit
    }
    func load(key: String, operation: @escaping @Sendable () async throws -> Data) async throws -> Data {
        try Task.checkCancellation()
        if let value = bytes[key] { touch(key, order: &byteOrder); return value }
        let waiter = UUID()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(throwing: CancellationError()); return }
                if flights[key] == nil { flights[key] = Flight(operation: operation); queue.append(key) }
                flights[key]?.waiters[waiter] = continuation
                startQueued()
            }
        } onCancel: { Task { await self.cancel(key: key, waiter: waiter) } }
    }
    func image(key: String, maxPixelSize: Int, operation: @escaping @Sendable () async throws -> Data) async throws -> CGImage {
        try Task.checkCancellation()
        let variant = "\(key):\(maxPixelSize)"
        if let image = images[variant] { touch(variant, order: &imageOrder); return image }
        let current = generation
        let data = try await load(key: key, operation: operation)
        try Task.checkCancellation()
        guard current == generation else { throw CancellationError() }
        // Actor execution is off the main actor; ImageIO decodes only the requested size.
        if let image = images[variant] { touch(variant, order: &imageOrder); return image }
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else {
            bytes[key] = nil; byteOrder.removeAll { $0 == key }
            throw WardrobeError.unavailable
        }
        images[variant] = image; touch(variant, order: &imageOrder)
        while imageOrder.count > 160 || images.values.reduce(0, { $0 + $1.bytesPerRow * $1.height }) > imageLimit {
            images[imageOrder.removeFirst()] = nil
        }
        return image
    }
    private func touch(_ key: String, order: inout [String]) { order.removeAll { $0 == key }; order.append(key) }
    private func startQueued() {
        while running.count < concurrency && !queue.isEmpty {
            let key = queue.removeFirst()
            guard let flight = flights[key], flight.task == nil else { continue }
            running.insert(flight.id)
            flights[key]?.task = Task {
                let result: Result<Data, Error>
                do {
                    let data: Data
                    do { data = try await flight.operation() }
                    catch {
                        // One retry for a transient server/connection failure; never retry auth,
                        // missing photos, offline, or rate limits in a scrolling grid.
                        guard error as? WardrobeError == .unavailable || error as? OutfitError == .unavailable else { throw error }
                        try Task.checkCancellation()
                        try await Task.sleep(for: .milliseconds(500))
                        data = try await flight.operation()
                    }
                    result = .success(data)
                } catch { result = .failure(error) }
                finish(key: key, id: flight.id, result: result)
            }
        }
    }
    private func finish(key: String, id: UUID, result: Result<Data, Error>) {
        running.remove(id)
        if let flight = flights[key], flight.id == id {
            flights[key] = nil
            if case .success(let value) = result {
                bytes[key] = value; touch(key, order: &byteOrder)
                while byteOrder.count > 160 || bytes.values.reduce(0, { $0 + $1.count }) > byteLimit { bytes[byteOrder.removeFirst()] = nil }
            }
            for continuation in flight.waiters.values { continuation.resume(with: result) }
        }
        startQueued()
    }
    private func cancel(key: String, waiter: UUID) {
        guard let continuation = flights[key]?.waiters.removeValue(forKey: waiter) else { return }
        continuation.resume(throwing: CancellationError())
        if flights[key]?.waiters.isEmpty == true {
            flights[key]?.task?.cancel(); flights[key] = nil; queue.removeAll { $0 == key }
        }
    }
    func clear() {
        generation = UUID()
        for flight in flights.values {
            flight.task?.cancel()
            for continuation in flight.waiters.values { continuation.resume(throwing: CancellationError()) }
        }
        flights = [:]; queue = []; bytes = [:]; byteOrder = []; images = [:]; imageOrder = []
        // Running slots are released by finish, even if a transport ignores cancellation.
    }
}

@MainActor struct RemotePhoto: View {
    @EnvironmentObject private var services: AppServices
    @ObservedObject private var refresh = PhotoRefreshState.shared
    let collection: String
    let identity: String
    let revision: String
    let label: String
    var maxPixelSize = 600
    let operation: @Sendable () async throws -> Data
    @State private var image: CGImage?
    @State private var displayedIdentity: String?
    @State private var failed = false
    @State private var loading = false
    @State private var attempt = 0
    @State private var loadID = UUID()
    private var account: String { services.user?.id ?? "" }
    private var owner: String { "\(account):\(collection):\(identity)" }
    private var key: String { "\(owner):\(revision):\(refresh.version(account: account, collection: collection))" }
    var body: some View {
        ZStack {
            CapsuleStyle.canvas
            if let image, displayedIdentity == owner {
                Image(decorative: image, scale: 1).resizable().scaledToFit()
            } else if loading && !failed { ProgressView().controlSize(.small) }
            if failed {
                Button { attempt += 1 } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 16)).frame(width: 44, height: 44).background(CapsuleStyle.canvas.opacity(0.9))
                }.accessibilityLabel("reload photo")
            }
        }.clipped().accessibilityLabel(label)
        .task(id: "\(key):\(maxPixelSize):\(attempt)") {
            let current = UUID(); loadID = current
            let expectedOwner = owner
            if displayedIdentity != expectedOwner { image = nil }
            failed = false; loading = false
            guard !account.isEmpty else { return }
            let progress = Task { @MainActor in
                do { try await Task.sleep(for: .milliseconds(250)); loading = true } catch {}
            }
            defer { progress.cancel(); if loadID == current { loading = false } }
            do {
                let result = try await WardrobePhotoCache.shared.image(key: key, maxPixelSize: maxPixelSize, operation: operation)
                guard !Task.isCancelled, expectedOwner == owner else { return }
                image = result; displayedIdentity = expectedOwner
            } catch { if !Task.isCancelled && expectedOwner == owner { failed = true } }
        }
    }
}
