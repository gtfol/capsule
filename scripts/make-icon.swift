import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Original, code-drawn icon: one garment inside a capture frame.
let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(gray: 0.055, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
context.setStrokeColor(CGColor(red: 0.72, green: 0.80, blue: 0.68, alpha: 1))
context.setLineWidth(16); context.setLineCap(.round); context.setLineJoin(.round)
for (x,y,sx,sy) in [(220.0,220.0,1.0,1.0),(804,220,-1,1),(220,804,1,-1),(804,804,-1,-1)] {
    context.move(to: CGPoint(x:x+sx*82,y:y));context.addLine(to:CGPoint(x:x,y:y));context.addLine(to:CGPoint(x:x,y:y+sy*82));context.strokePath()
}
context.setStrokeColor(CGColor(gray: 0.92, alpha: 1)); context.setLineWidth(18)
context.move(to: CGPoint(x: 426, y: 700))
context.addCurve(to: CGPoint(x: 598, y: 700), control1: CGPoint(x: 455, y: 620), control2: CGPoint(x: 569, y: 620))
for point in [CGPoint(x:665,y:673),CGPoint(x:739,y:565),CGPoint(x:658,y:517),CGPoint(x:627,y:568),CGPoint(x:627,y:332),CGPoint(x:397,y:332),CGPoint(x:397,y:568),CGPoint(x:366,y:517),CGPoint(x:285,y:565),CGPoint(x:359,y:673)] { context.addLine(to:point) }
context.closePath();context.strokePath()
let url = URL(fileURLWithPath: "CapsuleScan/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(output, context.makeImage()!, nil)
precondition(CGImageDestinationFinalize(output))
