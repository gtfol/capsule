import XCTest
import CoreImage
import ImageIO
#if canImport(CapsuleScan)
@testable import CapsuleScan
#else
@testable import CapsuleScanCore
#endif

final class IsolationTests: XCTestCase {
    static func fixture() throws -> Data {
        let foreground = CIImage(color: CIColor(red: 0, green: 0, blue: 1))
            .cropped(to: CGRect(x: 40, y: 70, width: 200, height: 300))
        return try CutoutRenderer.png(foreground, originalSize: CGSize(width: 900, height: 1200))
    }
    func testCutoutKeepsOriginalAspectRatioAndTransparentPadding() throws {
        let png = try Self.fixture()
        let source = try XCTUnwrap(CGImageSourceCreateWithData(png as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(source) as String?, "public.png")
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertEqual(Double(image.width) / Double(image.height), 0.75, accuracy: 0.002)
        XCTAssertLessThan(image.height, 1200) // Crop to the subject, don't retain the original canvas.
        let ci = CIImage(cgImage: image)
        XCTAssertEqual(pixel(ci, x: 2, y: 2)[3], 0)
        XCTAssertEqual(pixel(ci, x: image.width / 2, y: image.height / 2), [0, 0, 255, 255])
        // The 200 x 300 subject is centered at its original size, without distortion or clipping.
        XCTAssertEqual(pixel(ci, x: image.width / 2 + 95, y: image.height / 2 + 145)[3], 255)
        XCTAssertEqual(pixel(ci, x: image.width / 2 + 105, y: image.height / 2)[3], 0)
    }
    func testLandscapeSquareAndPortraitKeepRatioAndPixelLimit() throws {
        let subject = CIImage(color: .black).cropped(to: CGRect(x: 0, y: 0, width: 1600, height: 1200))
        for size in [CGSize(width: 1600, height: 900), CGSize(width: 1200, height: 1600), CGSize(width: 1600, height: 1600)] {
            let data = try CutoutRenderer.png(subject, originalSize: size)
            let image = try XCTUnwrap(CIImage(data: data))
            XCTAssertLessThanOrEqual(max(image.extent.width, image.extent.height), 1600)
            XCTAssertEqual(image.extent.width / image.extent.height, size.width / size.height, accuracy: 0.002)
            XCTAssertEqual(pixel(image, x: 1, y: 1)[3], 0)
        }
    }
    func testUploadAndDownsamplingPreserveAlphaAndPNGType() async throws {
        let cutout = try Self.fixture()
        let resized = try await ImageProcessor().preservingTransparency(cutout, maxEdge: 160, quality: 0.5)
        XCTAssertEqual(max(resized.width, resized.height), 160)
        XCTAssertTrue(PhotoEncoding.isPNG(resized.data))
        XCTAssertEqual(pixel(try XCTUnwrap(CIImage(data: resized.data)), x: 1, y: 1)[3], 0)
        let body = try await CapsulePayloadBuilder(images: ImageProcessor()).prepare(fields: ItemFields(name: "shirt"), image: cutout)
        XCTAssertLessThan(body.count, 3_800_000)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let url = try XCTUnwrap(json["imageData"] as? String)
        XCTAssertTrue(url.hasPrefix("data:image/png;base64,"))
        let data = try XCTUnwrap(Data(base64Encoded: String(url.split(separator: ",")[1])))
        XCTAssertLessThanOrEqual(data.count, 1_500_000)
        XCTAssertEqual(pixel(try XCTUnwrap(CIImage(data: data)), x: 1, y: 1)[3], 0)
    }
    func testTransparentDraftCanBeStoredAndRead() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let media = LocalMediaStore(directory: directory)
        let data = try Self.fixture()
        let reference = try await media.write(data, extension: PhotoEncoding.suffix(data))
        XCTAssertTrue(reference.hasSuffix(".png"))
        let saved = try await media.read(reference)
        XCTAssertEqual(saved, data)
    }
    func testInvalidCutoutsAndInputAreRejected() async {
        let size = CGSize(width: 900, height: 1200)
        XCTAssertThrowsError(try CutoutRenderer.png(CIImage.empty(), originalSize: size))
        XCTAssertThrowsError(try CutoutRenderer.png(CIImage(color: .white), originalSize: size))
        XCTAssertThrowsError(try CutoutRenderer.png(CIImage.empty(), originalSize: .zero))
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
