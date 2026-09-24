import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct ProcessedImage: Sendable {
    let data: Data
    let width: Int
    let height: Int
}
protocol ImageProcessing: Sendable {
    func jpeg(_ data: Data, maxEdge: Int, quality: Double) async throws -> ProcessedImage
}

actor ImageProcessor: ImageProcessing {
    // ImageIO downsamples during decode, avoiding a full-size camera image in memory.
    func jpeg(_ data: Data, maxEdge: Int = 1600, quality: Double = 0.85) throws -> ProcessedImage {
        guard maxEdge > 0, !data.isEmpty,
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: min(1600, maxEdge),
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { throw ScanError.invalidImage }
        let width = thumbnail.width, height = thumbnail.height
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw ScanError.invalidImage }
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(thumbnail, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let image = context.makeImage() else { throw ScanError.invalidImage }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { throw ScanError.invalidImage }
        // No source metadata, location, orientation, or EXIF is copied.
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: min(1, max(0.1, quality))] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw ScanError.invalidImage }
        return ProcessedImage(data: output as Data, width: width, height: height)
    }
}

protocol MediaStoring: Sendable {
    func write(_ data: Data, extension suffix: String) async throws -> String
    func read(_ reference: String) async throws -> Data
    func remove(_ reference: String) async
}

actor LocalMediaStore: MediaStoring {
    private let directory: URL
    init(directory: URL) { self.directory = directory }
    func write(_ data: Data, extension suffix: String) throws -> String {
        guard ["jpg", "json"].contains(suffix) else { throw ScanError.storage }
        let reference = UUID().uuidString + "." + suffix
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = try file(reference)
            #if os(iOS)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            #else
            try data.write(to: url, options: .atomic)
            #endif
            return reference
        } catch { throw ScanError.storage }
    }
    func read(_ reference: String) throws -> Data {
        do { return try Data(contentsOf: file(reference)) }
        catch { throw ScanError.storage }
    }
    func remove(_ reference: String) { if let url = try? file(reference) { try? FileManager.default.removeItem(at: url) } }
    private func file(_ reference: String) throws -> URL {
        guard reference == (reference as NSString).lastPathComponent, !reference.hasPrefix("."),
              ["jpg", "json"].contains((reference as NSString).pathExtension),
              UUID(uuidString: (reference as NSString).deletingPathExtension) != nil else { throw ScanError.storage }
        return directory.appendingPathComponent(reference)
    }
}
