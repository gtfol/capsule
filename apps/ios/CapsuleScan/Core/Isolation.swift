import Foundation
import CoreImage
import ImageIO
import Vision

protocol ImageIsolating: Sendable {
    func isolate(_ image: Data) async throws -> ProcessedImage
}

enum IsolationError: Error { case noSubject }

actor VisionImageIsolator: ImageIsolating {
    func isolate(_ image: Data) async throws -> ProcessedImage {
        // Normalize orientation and bound memory before Vision decodes the photo.
        let normalized = try await ImageProcessor().jpeg(image, maxEdge: 1600, quality: 0.95)
        try Task.checkCancellation()
        let handler = VNImageRequestHandler(data: normalized.data, options: [:])
        let request = VNGenerateForegroundInstanceMaskRequest()
        try handler.perform([request])
        try Task.checkCancellation()
        guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
            throw IsolationError.noSubject
        }
        // Keep all foreground instances so a pair of shoes or separate straps aren't discarded.
        // This separates foreground subjects; it does not classify garments.
        let masked = try observation.generateMaskedImage(ofInstances: observation.allInstances,
                                                         from: handler, croppedToInstancesExtent: true)
        try Task.checkCancellation()
        let png = try CutoutRenderer.png(CIImage(cvPixelBuffer: masked),
                                         originalSize: CGSize(width: normalized.width, height: normalized.height))
        let result = try await ImageProcessor().png(png, maxEdge: 1600)
        try Task.checkCancellation()
        return result
    }
}

enum CutoutRenderer {
    // Fit the complete subject inside the original photo's proportions, without stretching.
    // PNG keeps the surrounding space transparent through previews, drafts, and uploads.
    static func png(_ foreground: CIImage, originalSize: CGSize) throws -> Data {
        let extent = foreground.extent.integral
        guard !extent.isEmpty, !extent.isInfinite, !extent.isNull,
              extent.width <= 1600, extent.height <= 1600,
              originalSize.width.isFinite, originalSize.height.isFinite,
              originalSize.width > 0, originalSize.height > 0,
              originalSize.width <= 1600, originalSize.height <= 1600 else { throw ScanError.invalidImage }
        let ratio = originalSize.width / originalSize.height
        let padding = ceil(max(extent.width, extent.height) * 0.05)
        let height = max(extent.height + padding * 2, (extent.width + padding * 2) / ratio)
        let width = height * ratio
        let scale = min(1, 1600 / max(width, height))
        let canvas = CGRect(x: 0, y: 0, width: (width * scale).rounded(), height: (height * scale).rounded())
        guard canvas.width > 0, canvas.height > 0 else { throw ScanError.invalidImage }
        let positioned = foreground
            .transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .transformed(by: CGAffineTransform(translationX: (canvas.width - extent.width * scale) / 2,
                                               y: (canvas.height - extent.height * scale) / 2))
        let transparent = CIImage(color: .clear).cropped(to: canvas)
        let output = positioned.composited(over: transparent).cropped(to: canvas)
        let context = CIContext(options: [.workingColorSpace: CGColorSpaceCreateDeviceRGB()])
        guard let data = context.pngRepresentation(of: output, format: .RGBA8,
                                                   colorSpace: CGColorSpaceCreateDeviceRGB()) else {
            throw ScanError.invalidImage
        }
        return data
    }
}
