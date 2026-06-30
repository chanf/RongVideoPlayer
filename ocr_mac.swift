import Foundation
import Vision
import AppKit

// 1. 获取命令行传入的图片路径
guard CommandLine.arguments.count > 1 else {
    print("Usage: ocr_mac <image-path>")
    exit(1)
}
let imagePath = CommandLine.arguments[1]

// 2. 加载图片并转换为 CGImage
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("Error: 无法加载图片")
    exit(1)
}

// 3. 创建 Vision OCR 请求
let requestHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
let request = VNRecognizeTextRequest { request, error in
    if let error = error {
        print("OCR 失败: \(error.localizedDescription)")
        return
    }
    
    // 获取识别到的文本结果
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    let lines = observations.compactMap { $0.topCandidates(1).first?.string }
    print(lines.joined(separator: "\n"))
}

// 4. 设置识别语言（zh-Hans 代表简体中文，en-US 代表英文）
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true // 启用语言自动矫正

// 5. 执行识别
do {
    try requestHandler.perform([request])
} catch {
    print("请求执行出错: \(error.localizedDescription)")
    exit(1)
}
