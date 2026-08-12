import Foundation
import Vision
import ImageIO

struct OCRLine: Codable {
  let text: String
  let confidence: Double
  let bbox: [Double]
}

struct OCRResult: Codable {
  let width: Int
  let height: Int
  let lines: [OCRLine]
}

enum OCRError: Error {
  case invalidArgs
  case imageLoadFailed
}

func loadImage(_ path: String) throws -> CGImage {
  let url = URL(fileURLWithPath: path)
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw OCRError.imageLoadFailed
  }
  return image
}

func runOCR(image: CGImage) throws -> OCRResult {
  var recognizedLines: [OCRLine] = []
  let width = image.width
  let height = image.height

  let request = VNRecognizeTextRequest { request, error in
    if error != nil {
      return
    }

    let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
    for observation in observations {
      guard let candidate = observation.topCandidates(1).first else { continue }
      let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
      if text.isEmpty { continue }
      let box = observation.boundingBox
      let x = box.minX * Double(width)
      let y = (1.0 - box.maxY) * Double(height)
      let w = box.width * Double(width)
      let h = box.height * Double(height)
      recognizedLines.append(
        OCRLine(
          text: text,
          confidence: Double(candidate.confidence),
          bbox: [x, y, w, h]
        )
      )
    }
  }

  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.minimumTextHeight = 0.012
  request.recognitionLanguages = ["zh-Hans", "en-US"]

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  recognizedLines.sort { lhs, rhs in
    let ly = lhs.bbox[1]
    let ry = rhs.bbox[1]
    if abs(ly - ry) > 6 {
      return ly < ry
    }
    return lhs.bbox[0] < rhs.bbox[0]
  }

  return OCRResult(width: width, height: height, lines: recognizedLines)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  fputs("{\"error\":\"image path is required\"}\n", stderr)
  exit(1)
}

do {
  let image = try loadImage(args[1])
  let result = try runOCR(image: image)
  let data = try JSONEncoder().encode(result)
  if let output = String(data: data, encoding: .utf8) {
    print(output)
  } else {
    throw OCRError.invalidArgs
  }
} catch {
  fputs("{\"error\":\"ocr failed\"}\n", stderr)
  exit(1)
}
