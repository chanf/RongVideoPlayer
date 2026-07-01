import Foundation
import PDFKit
import AppKit

func outputJSON(_ object: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: []),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    }
}

func fail(_ message: String) -> Never {
    outputJSON(["success": false, "error": message])
    exit(1)
}

let args = CommandLine.arguments
if args.count < 3 {
    fail("Usage: pdf_render_mac <info|render> <pdf-path> [page-index scale output-path]")
}

let command = args[1]
let pdfPath = args[2]
let pdfURL = URL(fileURLWithPath: pdfPath)

guard FileManager.default.fileExists(atPath: pdfPath) else {
    fail("PDF file does not exist: \(pdfPath)")
}

guard let document = PDFDocument(url: pdfURL) else {
    fail("Unable to open PDF: \(pdfPath)")
}

if command == "info" {
    let attrs = document.documentAttributes ?? [:]
    let title = (attrs[PDFDocumentAttribute.titleAttribute] as? String) ?? pdfURL.deletingPathExtension().lastPathComponent
    outputJSON([
        "success": true,
        "pageCount": document.pageCount,
        "title": title
    ])
    exit(0)
}

if command == "render" {
    if args.count < 6 {
        fail("Usage: pdf_render_mac render <pdf-path> <page-index> <scale> <output-path>")
    }

    guard let pageIndex = Int(args[3]) else {
        fail("Invalid page index: \(args[3])")
    }

    guard let scaleValue = Double(args[4]), scaleValue > 0 else {
        fail("Invalid render scale: \(args[4])")
    }

    let scale = CGFloat(scaleValue)
    let outputPath = args[5]

    guard pageIndex >= 0, pageIndex < document.pageCount, let page = document.page(at: pageIndex) else {
        fail("Page index out of range: \(pageIndex)")
    }

    let bounds = page.bounds(for: .cropBox)
    let targetSize = NSSize(
        width: max(1, ceil(bounds.width * scale)),
        height: max(1, ceil(bounds.height * scale))
    )

    // PDFPage.thumbnail lets PDFKit handle page rotation and coordinate systems.
    // Drawing manually into a CGContext is easy to get flipped/mirrored on macOS.
    let image = page.thumbnail(of: targetSize, for: .cropBox)
    guard let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let pngData = bitmap.representation(using: .png, properties: [:]) else {
        fail("Unable to encode page as PNG")
    }

    do {
        let outputURL = URL(fileURLWithPath: outputPath)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try pngData.write(to: outputURL)
        outputJSON([
            "success": true,
            "pageIndex": pageIndex,
            "width": bitmap.pixelsWide,
            "height": bitmap.pixelsHigh,
            "outputPath": outputPath
        ])
    } catch {
        fail("Unable to write rendered page: \(error.localizedDescription)")
    }

    exit(0)
}

fail("Unknown command: \(command)")
