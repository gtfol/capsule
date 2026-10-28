import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

// Restore the web mark's original Arial Bold lowercase c, at its original size.
// Center the visible glyph, not its font metrics; iOS applies the rounded mask.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8,
                              bytesPerRow: 0, space: colorSpace,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fatalError("An RGB drawing context is required.")
}
let bounds = CGRect(x: 0, y: 0, width: 1024, height: 1024)
context.setFillColor(CGColor(gray: 1, alpha: 1))
context.fill(bounds)
let font = CTFontCreateWithName("Arial-BoldMT" as CFString, 112 * 8, nil)
precondition(CTFontCopyPostScriptName(font) as String == "Arial-BoldMT", "Arial Bold is required to match capsule's mark.")
var character: UniChar = 0x63 // lowercase c
var glyph: CGGlyph = 0
precondition(CTFontGetGlyphsForCharacters(font, &character, &glyph, 1))
guard let path = CTFontCreatePathForGlyph(font, glyph, nil) else { fatalError("Could not create capsule's mark.") }
let glyphBounds = path.boundingBoxOfPath
context.translateBy(x: bounds.midX - glyphBounds.midX, y: bounds.midY - glyphBounds.midY)
context.setFillColor(CGColor(gray: 0, alpha: 1))
context.addPath(path)
context.fillPath()

let outputURL = root.appendingPathComponent("CapsuleScan/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
guard let renderedImage = context.makeImage(),
      let output = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Could not create the app icon.")
}
CGImageDestinationAddImage(output, renderedImage, nil)
precondition(CGImageDestinationFinalize(output), "Could not save the app icon.")
