import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

// Match capsule's public/icon.svg: a black lowercase c on opaque white.
// The SVG uses a 128-point canvas, Arial bold at 112 points, x: 26, baseline: 94.
let scale: CGFloat = 8
let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(gray: 1, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
let font = CTFontCreateWithName("Arial-BoldMT" as CFString, 112 * scale, nil)
precondition(CTFontCopyPostScriptName(font) as String == "Arial-BoldMT", "Arial Bold is required to match capsule's mark.")
let mark = NSAttributedString(string: "c", attributes: [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
])
context.textPosition = CGPoint(x: 26 * scale, y: (128 - 94) * scale)
CTLineDraw(CTLineCreateWithAttributedString(mark), context)
let url = URL(fileURLWithPath: "CapsuleScan/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(output, context.makeImage()!, nil)
precondition(CGImageDestinationFinalize(output))
