import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Preserve the approved artwork; iOS applies the rounded icon mask itself.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let sourceURL = root.appendingPathComponent("marketing/brand/app-icon-source.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      image.width == image.height,
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8,
                              bytesPerRow: 0, space: colorSpace,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fatalError("A square app-icon source and an RGB drawing context are required.")
}
let bounds = CGRect(x: 0, y: 0, width: 1024, height: 1024)
context.setFillColor(CGColor(gray: 0, alpha: 1))
context.fill(bounds)
context.interpolationQuality = .high
context.draw(image, in: bounds)

let outputURL = root.appendingPathComponent("CapsuleScan/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
guard let renderedImage = context.makeImage(),
      let output = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Could not create the app icon.")
}
CGImageDestinationAddImage(output, renderedImage, nil)
precondition(CGImageDestinationFinalize(output), "Could not save the app icon.")
