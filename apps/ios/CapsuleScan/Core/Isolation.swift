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
        let jpeg = try CutoutRenderer.jpeg(CIImage(cvPixelBuffer: masked))
        let result = try await ImageProcessor().jpeg(jpeg, maxEdge: 1600, quality: 0.9)
        try Task.checkCancellation()
        return result
    }
}

enum CutoutRenderer {
    // Vision supplies a tight alpha crop. Add breathing room and flatten onto white,
    // keeping the same JPEG format used by local drafts and capsule uploads.
    static func jpeg(_ foreground: CIImage) throws -> Data {
        let extent = foreground.extent.integral
        guard !extent.isEmpty, !extent.isInfinite, !extent.isNull,
              extent.width <= 1600, extent.height <= 1600 else { throw ScanError.invalidImage }
        let padding = ceil(max(extent.width, extent.height) * 0.05)
        let canvas = CGRect(x: 0, y: 0, width: extent.width + padding * 2, height: extent.height + padding * 2)
        let positioned = foreground.transformed(by: CGAffineTransform(translationX: padding - extent.minX,
                                                                       y: padding - extent.minY))
        let white = CIImage(color: .white).cropped(to: canvas)
        let opaque = positioned.composited(over: white).cropped(to: canvas)
        let context = CIContext(options: [.workingColorSpace: CGColorSpaceCreateDeviceRGB()])
        guard let data = context.jpegRepresentation(of: opaque, colorSpace: CGColorSpaceCreateDeviceRGB(),
                                                    options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.95]) else {
            throw ScanError.invalidImage
        }
        return data
    }
}
