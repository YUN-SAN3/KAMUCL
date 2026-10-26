// QA-only visible display capture. No application/window replacement or permission prompt.
// Apple: SCStreamConfiguration.minimumFrameInterval / queueDepth; SCStreamFrameInfo.status.
import Foundation
import AppKit
import ScreenCaptureKit
import CoreMedia
import CoreVideo
import QuartzCore
import CryptoKit
import Darwin

struct Request: Decodable {
    struct Rect: Codable { let x: Double; let y: Double; let width: Double; let height: Double
        var cg: CGRect { CGRect(x: x, y: y, width: width, height: height) }
    }
    let displayID: UInt32
    let ownerPID: Int32
    let windowBounds: Rect
    let crop: Rect
    let expectedScale: Double
    let capturePurpose: String?
}

func timeFields(_ t: CMTime) -> [String: Any] {
    var result: [String: Any] = ["value": String(t.value), "timescale": t.timescale, "flags": t.flags.rawValue, "epoch": String(t.epoch), "valid": t.isValid, "numeric": t.isNumeric]
    let seconds = CMTimeGetSeconds(t)
    if seconds.isFinite { result["seconds"] = seconds }
    return result
}
func clockFields() -> [String: Any] {
    var scale = mach_timebase_info_data_t(); mach_timebase_info(&scale)
    return ["machAbsoluteTime": String(mach_absolute_time()), "machTimebaseNumer": scale.numer, "machTimebaseDenom": scale.denom,
            "caCurrentMediaTime": CACurrentMediaTime(), "hostTime": timeFields(CMClockGetTime(CMClockGetHostTimeClock())), "wallEpochSeconds": Date().timeIntervalSince1970]
}
func writeJSON(_ value: Any, _ url: URL) throws {
    let bytes = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    try bytes.write(to: url, options: .atomic)
}
func rectFields(_ r: CGRect) -> [String: Double] { ["x": Double(r.origin.x), "y": Double(r.origin.y), "width": Double(r.width), "height": Double(r.height)] }
func measuredSink<T>(_ metrics: inout [String: Any], _ name: String, _ action: () throws -> T) rethrows -> T {
    let began = CACurrentMediaTime()
    defer { let ended = CACurrentMediaTime(); metrics[name] = ["startMonotonicSeconds": began, "endMonotonicSeconds": ended, "durationMs": (ended - began) * 1000] }
    return try action()
}

@available(macOS 12.3, *)
final class Collector: NSObject, SCStreamOutput, SCStreamDelegate {
    let directory: URL
    let queue = DispatchQueue(label: "kamu.qa.native.logo.frames")
    var records: [[String: Any]] = []
    var sinkMetrics: [[String: Any]] = []
    var errorMessage: String?
    var previousHash: String?
    var ready = false
    var identity: [String: Any] = [:]
    init(_ directory: URL) { self.directory = directory }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async { self.errorMessage = "SCStream: \(error)" }
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen else { return }
        let index = records.count
        let sinkBegan = CACurrentMediaTime()
        var metrics: [String: Any] = ["index": index, "startMonotonicSeconds": sinkBegan]
        defer { let ended = CACurrentMediaTime(); metrics["endMonotonicSeconds"] = ended; metrics["durationMs"] = (ended - sinkBegan) * 1000; sinkMetrics.append(metrics) }
        let attachments = (CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first ?? [:]
        let statusRaw = (attachments[.status] as? NSNumber)?.intValue
        let status = statusRaw.flatMap { SCFrameStatus(rawValue: $0) }
        var row: [String: Any] = ["index": index, "callbackClock": clockFields(), "validSample": sample.isValid,
                                  "presentationTime": timeFields(CMSampleBufferGetPresentationTimeStamp(sample)),
                                  "duration": timeFields(CMSampleBufferGetDuration(sample)), "statusRaw": statusRaw.map { $0 as Any } ?? NSNull(),
                                  "status": status.map { String(describing: $0) } ?? "unknown", "complete": status == .complete]
        if let t = attachments[.displayTime] as? NSNumber { row["displayTime"] = t.stringValue }
        for key in [SCStreamFrameInfo.scaleFactor, .contentScale] {
            if let v = attachments[key] as? NSNumber { row[key.rawValue] = v }
        }
        if let dictionary = attachments[.contentRect] as? [String: Any], let rect = CGRect(dictionaryRepresentation: dictionary as CFDictionary) { row["contentRect"] = rectFields(rect) }
        do {
            // Preserve even non-complete samples' supplied pixels, while keeping
            // their status. Never count idle/blank/stopped as new display updates.
            if let pixel = CMSampleBufferGetImageBuffer(sample) {
                guard CVPixelBufferGetPixelFormatType(pixel) == kCVPixelFormatType_32BGRA else { throw NSError(domain: "NativeLogoCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unexpected actual pixel format"]) }
                let lock = CVPixelBufferLockBaseAddress(pixel, .readOnly)
                guard lock == kCVReturnSuccess else { throw NSError(domain: "NativeLogoCapture", code: 2) }
                defer { CVPixelBufferUnlockBaseAddress(pixel, .readOnly) }
                let width = CVPixelBufferGetWidth(pixel), height = CVPixelBufferGetHeight(pixel), stride = CVPixelBufferGetBytesPerRow(pixel)
                guard let base = CVPixelBufferGetBaseAddress(pixel), width > 0, height > 0, stride >= width * 4 else { throw NSError(domain: "NativeLogoCapture", code: 3) }
                // Lossless original BGRA rows, removing only uninitialised padding.
                var bytes = Data(capacity: width * height * 4)
                for y in 0..<height { bytes.append(base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self), count: width * 4) }
                let filename = String(format: "frame-%06d.bgra", index)
                try measuredSink(&metrics, "bgraWrite") { try bytes.write(to: directory.appendingPathComponent(filename), options: .withoutOverwriting) }
                let hash = measuredSink(&metrics, "hash") { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
                row["file"] = filename; row["width"] = width; row["height"] = height; row["sourceBytesPerRow"] = stride
                row["packedBytesPerRow"] = width * 4; row["bytes"] = bytes.count; row["sha256"] = hash
                row["samePixelsAsPrevious"] = previousHash.map { $0 == hash } ?? false
                row["hasPreviousPixels"] = previousHash != nil
                previousHash = hash
            }
            records.append(row)
            // Each JSON survives a later stream error/process interruption.
            try measuredSink(&metrics, "sidecarWrite") { try writeJSON(row, directory.appendingPathComponent(String(format: "frame-%06d.json", index))) }
            if !ready && sample.isValid && status == .complete && row["file"] != nil && CMSampleBufferGetPresentationTimeStamp(sample).isNumeric {
                try measuredSink(&metrics, "readyWrite") { try writeJSON(["firstFrame": row, "identity": identity, "clock": clockFields()], directory.appendingPathComponent("ready.json")) }
                ready = true
            }
        } catch { metrics["failed"] = true; errorMessage = "Frame preservation failed: \(error)" }
    }
}

@available(macOS 12.3, *)
func runCapture(_ requestURL: URL, _ directory: URL) async throws {
    let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: requestURL))
    let purpose = request.capturePurpose ?? "logo"
    guard purpose == "logo" || purpose == "skin-walk" else { throw NSError(domain: "NativeLogoCapture", code: 22, userInfo: [NSLocalizedDescriptionKey: "Unsupported controlled capture purpose"]) }
    // Never use CGRequestScreenCaptureAccess: permission failure is explicit and
    // cannot pop an interactive request on a CI machine.
    guard CGPreflightScreenCaptureAccess() else { throw NSError(domain: "NativeLogoCapture", code: 10, userInfo: [NSLocalizedDescriptionKey: "Screen recording permission not pre-authorized; no prompt requested"]) }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == request.displayID }) else { throw NSError(domain: "NativeLogoCapture", code: 11, userInfo: [NSLocalizedDescriptionKey: "Requested visible display missing"]) }
    let crop = request.crop.cg
    // The existing LOGO contract remains 256pt. Walking captures must include
    // the complete measured canvas, with an independent bounded 512pt contract.
    let maximum: CGFloat = purpose == "skin-walk" ? 512.0 : 256.0
    guard crop.width > 0, crop.height > 0, crop.width <= maximum, crop.height <= maximum, display.frame.contains(crop) else { throw NSError(domain: "NativeLogoCapture", code: 12, userInfo: [NSLocalizedDescriptionKey: "Complete \(purpose) region must fit the actual display and its explicit \(maximum)pt bound"]) }
    let matches = content.windows.filter { w in
        w.owningApplication?.processID == request.ownerPID && w.isOnScreen && w.windowLayer == 0 &&
        abs(w.frame.minX - request.windowBounds.x) <= 1 && abs(w.frame.minY - request.windowBounds.y) <= 1 &&
        abs(w.frame.width - request.windowBounds.width) <= 1 && abs(w.frame.height - request.windowBounds.height) <= 1
    }
    guard matches.count == 1, let window = matches.first, window.frame.contains(crop) else { throw NSError(domain: "NativeLogoCapture", code: 13, userInfo: [NSLocalizedDescriptionKey: "Cannot uniquely identify the on-screen launcher window enclosing LOGO"]) }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == request.ownerPID else { throw NSError(domain: "NativeLogoCapture", code: 14, userInfo: [NSLocalizedDescriptionKey: "Launcher is not actually foreground"]) }
    guard let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == request.displayID }) else { throw NSError(domain: "NativeLogoCapture", code: 15) }
    let scale = Double(screen.backingScaleFactor)
    guard scale == request.expectedScale else { throw NSError(domain: "NativeLogoCapture", code: 16, userInfo: [NSLocalizedDescriptionKey: "Actual native display scale differs from supplied geometry"]) }
    if purpose == "skin-walk" {
        guard crop.width * scale <= 1024 && crop.height * scale <= 1024 else { throw NSError(domain: "NativeLogoCapture", code: 23, userInfo: [NSLocalizedDescriptionKey: "Whole walking canvas exceeds bounded original pixel dimensions; partial crop is forbidden"]) }
    }
    let configuration = SCStreamConfiguration()
    configuration.sourceRect = crop.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
    configuration.width = Int((crop.width * scale).rounded(.up)); configuration.height = Int((crop.height * scale).rounded(.up))
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    configuration.minimumFrameInterval = .zero // System maximum; no invented FPS.
    configuration.queueDepth = 5 // Apple recommends <=8; bounded IOSurface queue.
    configuration.showsCursor = false
    let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
    let collector = Collector(directory)
    collector.identity = ["displayID": display.displayID, "displayBounds": rectFields(display.frame), "displayPixels": ["width": display.width, "height": display.height], "backingScaleFactor": scale,
                          "windowID": window.windowID, "ownerPID": request.ownerPID, "windowBounds": rectFields(window.frame), "globalCrop": rectFields(crop), "sourceRect": rectFields(configuration.sourceRect),
                          "outputWidth": configuration.width, "outputHeight": configuration.height, "pixelFormat": "BGRA8", "minimumFrameInterval": timeFields(.zero), "queueDepth": 5,
                          "capturePurpose": purpose,
                          "source": "visible full-display filter cropped to actual on-screen \(purpose) ROI; no window replacement/exclusion; cursor omitted"]
    try writeJSON(collector.identity, directory.appendingPathComponent("identity.json"))
    let stream = SCStream(filter: filter, configuration: configuration, delegate: collector)
    try stream.addStreamOutput(collector, type: .screen, sampleHandlerQueue: collector.queue)
    var started = false, failure: Error?
    do {
        try await stream.startCapture(); started = true
        let began = ProcessInfo.processInfo.systemUptime
        var marks = Set<String>()
        while !FileManager.default.fileExists(atPath: directory.appendingPathComponent("stop.request").path) {
            if let error = collector.queue.sync(execute: { collector.errorMessage }) { throw NSError(domain: "NativeLogoCapture", code: 17, userInfo: [NSLocalizedDescriptionKey: error]) }
            guard ProcessInfo.processInfo.systemUptime - began < 15 else { throw NSError(domain: "NativeLogoCapture", code: 18, userInfo: [NSLocalizedDescriptionKey: "Owned capture 15 second deadline exceeded"]) }
            for mark in ["clicks-start", "action-complete"] where !marks.contains(mark) && FileManager.default.fileExists(atPath: directory.appendingPathComponent(mark + ".request").path) {
                try writeJSON(["name": mark, "clock": clockFields()], directory.appendingPathComponent(mark + ".json")); marks.insert(mark)
            }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
    } catch { failure = error }
    var stopped = false
    if started { do { try await stream.stopCapture(); stopped = true } catch { failure = failure ?? error } }
    let state = collector.queue.sync { (collector.records, collector.errorMessage, collector.ready, collector.sinkMetrics) }
    if let error = state.1 { failure = failure ?? NSError(domain: "NativeLogoCapture", code: 19, userInfo: [NSLocalizedDescriptionKey: error]) }
    if !state.2 { failure = failure ?? NSError(domain: "NativeLogoCapture", code: 20, userInfo: [NSLocalizedDescriptionKey: "No valid complete first frame"]) }
    let manifest: [String: Any] = ["complete": failure == nil && stopped, "streamStarted": started, "streamStopped": stopped, "identity": collector.identity,
        "frames": state.0, "error": failure.map { String(describing: $0) } as Any? ?? NSNull(), "finishedClock": clockFields(),
        "sinkMetrics": state.3, "sinkMetricsScope": "Diagnostic serial callback begin/end and write/hash durations by original frame index, captured once without a second sidecar write. Original frame sidecars and manifest frame rows remain identical; PTS/status/FPS are unchanged. Monotonic durations are not display presentation or exclusive CPU time.",
        "dropCount": NSNull(), "dropCountKnown": false, "dropLimitation": "SCStreamOutput supplies frame statuses but no total missing/dropped frame callback count. Preserve all statuses; no zero-drop claim.",
        "timing": "Original CMSampleBuffer PTS and attachment displayTime; no interpolated frames, fixed-rate encoding, timestamp rewriting or synthetic duplicates"]
    try writeJSON(manifest, directory.appendingPathComponent("capture.json"))
    if let error = failure { throw error }
}

@main struct Main {
    static func main() async {
        guard CommandLine.arguments.count == 3 else { fputs("Usage: mac-logo-capture request.json output-directory\n", stderr); exit(2) }
        let request = URL(fileURLWithPath: CommandLine.arguments[1]), directory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        do {
            if #available(macOS 12.3, *) { try await runCapture(request, directory) }
            else { throw NSError(domain: "NativeLogoCapture", code: 21, userInfo: [NSLocalizedDescriptionKey: "macOS 12.3 ScreenCaptureKit required"]) }
        } catch {
            try? writeJSON(["complete": false, "error": String(describing: error), "clock": clockFields()], directory.appendingPathComponent("failure.json"))
            fputs("Native LOGO capture failed: \(error)\n", stderr); exit(1)
        }
    }
}
