import XCTest
import CoreImage
import ImageIO
#if canImport(CapsuleScan)
@testable import CapsuleScan
#else
@testable import CapsuleScanCore
#endif

final class IsolationTests: XCTestCase {
    func testCutoutHasWhitePaddingAndKeepsSubjectColor() throws {
        let foreground = CIImage(color: CIColor(red: 0, green: 0, blue: 1))
            .cropped(to: CGRect(x: 40, y: 70, width: 200, height: 300))
        let jpeg = try CutoutRenderer.jpeg(foreground)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(source) as String?, "public.jpeg")
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertEqual(image.width, 230); XCTAssertEqual(image.height, 330)
        let ci = CIImage(cgImage: image)
        let corner = pixel(ci, x: 2, y: 2)
        XCTAssertGreaterThan(corner[0], 245); XCTAssertGreaterThan(corner[1], 245); XCTAssertGreaterThan(corner[2], 245)
        let center = pixel(ci, x: 115, y: 165)
        XCTAssertLessThan(center[0], 10); XCTAssertLessThan(center[1], 10); XCTAssertGreaterThan(center[2], 245)
        XCTAssertEqual(center[3], 255)
    }
    func testPaddingStillRespects1600PixelLimitAndUploadBudget() async throws {
        let subject = CIImage(color: .black).cropped(to: CGRect(x: 0, y: 0, width: 1600, height: 1200))
        let cutout = try await ImageProcessor().jpeg(CutoutRenderer.jpeg(subject), maxEdge: 1600, quality: 0.9)
        XCTAssertEqual(cutout.width, 1600); XCTAssertEqual(Double(cutout.height), 1236.36, accuracy: 1)
        let body = try await CapsulePayloadBuilder(images: ImageProcessor()).prepare(fields: ItemFields(name: "shirt"), image: cutout.data)
        XCTAssertLessThan(body.count, 3_800_000)
    }
    func testInvalidCutoutsAndInputAreRejected() async {
        XCTAssertThrowsError(try CutoutRenderer.jpeg(CIImage.empty()))
        XCTAssertThrowsError(try CutoutRenderer.jpeg(CIImage(color: .white)))
        do {
            _ = try await VisionImageIsolator().isolate(Data())
            XCTFail("invalid image must fail before Vision")
        } catch { XCTAssertEqual(error as? ScanError, .invalidImage) }
    }
    private func pixel(_ image: CIImage, x: Int, y: Int) -> [UInt8] {
        var pixel = [UInt8](repeating: 0, count: 4)
        CIContext().render(image, toBitmap: &pixel, rowBytes: 4,
                           bounds: CGRect(x: x, y: y, width: 1, height: 1), format: .RGBA8,
                           colorSpace: CGColorSpaceCreateDeviceRGB())
        return pixel
    }
}
