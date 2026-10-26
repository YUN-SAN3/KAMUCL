// QA only: ephemeral GitHub-hosted Apple Silicon desktop, never a user desktop.
// Official APIs, no capture, virtual display, GPU, CSS, Dock or permanent preferences:
// https://developer.apple.com/documentation/coregraphics/cgdisplaysetdisplaymode(_:_:_:)
// Apple documents that this synchronous mode lasts for this process and reverts
// when it terminates. Keep this helper alive; additionally restore/verify explicitly.
// https://developer.apple.com/documentation/appkit/nsscreen/visibleframe
// visibleFrame is read anew: it excludes the actual menu bar/Dock, even auto-hide.
// https://developer.apple.com/documentation/iokit/iodisplaymodeinformation/1505482-flags
import Foundation
import AppKit
import CoreGraphics
import IOKit.graphics
import Darwin

struct DisplayFailure: Error, CustomStringConvertible { let description: String; init(_ text: String) { description = text } }
func require(_ condition: Bool, _ text: String) throws { if !condition { throw DisplayFailure(text) } }
func emit(_ value: [String: Any]) throws { let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])) }
func now() -> Double { Date().timeIntervalSince1970 * 1000 }
func rect(_ value: CGRect) -> [String: Double] { ["x": value.origin.x, "y": value.origin.y, "width": value.width, "height": value.height] }
let badQualityFlags = UInt32(kDisplayModeInterlacedFlag | kDisplayModeStretchedFlag | kDisplayModeNotGraphicsQualityFlag | kDisplayModeTelevisionFlag)
func modeInfo(_ mode: CGDisplayMode) -> [String: Any] {
    ["ioDisplayModeID": mode.ioDisplayModeID, "width": mode.width, "height": mode.height,
     "pixelWidth": mode.pixelWidth, "pixelHeight": mode.pixelHeight, "refreshRate": mode.refreshRate,
     "pixelEncoding": mode.pixelEncoding.map { $0 as String } as Any? ?? NSNull(),
     "ioFlags": mode.ioFlags, "guiUsable": mode.isUsableForDesktopGUI(), "qualityExcluded": (mode.ioFlags & badQualityFlags) != 0]
}
func activeDisplays() throws -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    try require(CGGetActiveDisplayList(0, nil, &count) == .success && count > 0, "CGGetActiveDisplayList count failed")
    let capacity = count
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(capacity))
    let result = displays.withUnsafeMutableBufferPointer { CGGetActiveDisplayList(capacity, $0.baseAddress, &count) }
    try require(result == .success && count <= capacity, "CGGetActiveDisplayList inventory changed")
    return Array(displays.prefix(Int(count)))
}
func screen(_ id: CGDirectDisplayID) throws -> NSScreen {
    guard let match = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id }) else { throw DisplayFailure("Actual NSScreen matching CGDisplayID missing") }
    return match
}
func available(_ id: CGDirectDisplayID) throws -> [CGDisplayMode] {
    let options = [kCGDisplayShowDuplicateLowResolutionModes as String: true] as CFDictionary
    guard let modes = CGDisplayCopyAllDisplayModes(id, options) as? [CGDisplayMode], !modes.isEmpty else { throw DisplayFailure("Actual available CGDisplayModes missing") }
    return modes
}
func inventory() throws -> [String: Any] {
    let ids = try activeDisplays(), main = CGMainDisplayID()
    let rows = try ids.map { id -> [String: Any] in
        guard let current = CGDisplayCopyDisplayMode(id) else { throw DisplayFailure("Actual current CGDisplayMode missing") }
        let ns = try screen(id)
        return ["displayID": id, "isMain": id == main, "mirrored": CGDisplayIsInMirrorSet(id) != 0,
                "frame": rect(ns.frame), "workArea": rect(ns.visibleFrame), "backingScaleFactor": ns.backingScaleFactor,
                "currentMode": modeInfo(current), "availableModes": try available(id).map(modeInfo)]
    }
    return ["atUnixMs": now(), "pid": getpid(), "platform": "darwin", "arch": "arm64", "mainDisplayID": main, "displays": rows]
}
func adequate(_ ns: NSScreen) -> Bool { ns.frame.width >= 1600 && ns.frame.height >= 1080 && ns.visibleFrame.width >= 1440 && ns.visibleFrame.height >= 960 }
func choose(_ id: CGDirectDisplayID, _ original: CGDisplayMode) throws -> CGDisplayMode? {
    let ns = try screen(id)
    try require(Double(original.width) == ns.frame.width && Double(original.height) == ns.frame.height, "CG mode dimensions do not match actual logical NSScreen frame; no guessed unit conversion")
    if adequate(ns) { return nil }
    try require(try activeDisplays() == [id] && CGDisplayIsInMirrorSet(id) == 0, "Only one non-mirrored actual main display may change mode")
    try require(original.refreshRate.isFinite && original.refreshRate > 0, "Original refresh rate is unknown; cannot prove a non-degrading mode change")
    guard let encoding = original.pixelEncoding else { throw DisplayFailure("Original pixel encoding unknown; cannot prove pixel quality") }
    let insetWidth = ns.frame.width - ns.visibleFrame.width, insetHeight = ns.frame.height - ns.visibleFrame.height
    let candidates = try available(id).filter { mode in
        mode.width >= 1600 && mode.height >= 1080 && Double(mode.width) - insetWidth >= 1440 && Double(mode.height) - insetHeight >= 960 &&
        mode.refreshRate.isFinite && mode.refreshRate >= original.refreshRate && mode.refreshRate > 0 &&
        mode.pixelWidth >= original.pixelWidth && mode.pixelHeight >= original.pixelHeight &&
        Double(mode.pixelWidth) / Double(mode.width) >= Double(original.pixelWidth) / Double(original.width) &&
        Double(mode.pixelHeight) / Double(mode.height) >= Double(original.pixelHeight) / Double(original.height) &&
        mode.pixelEncoding.map { $0 as String } == (encoding as String) && mode.isUsableForDesktopGUI() && (mode.ioFlags & badQualityFlags) == 0
    }.sorted { a, b in
        let left = [Double(a.width * a.height), Double(a.width), Double(a.height), a.refreshRate, Double(a.pixelWidth * a.pixelHeight), Double(a.ioDisplayModeID)]
        let right = [Double(b.width * b.height), Double(b.width), Double(b.height), b.refreshRate, Double(b.pixelWidth * b.pixelHeight), Double(b.ioDisplayModeID)]
        return left.lexicographicallyPrecedes(right)
    }
    guard let selected = candidates.first else { throw DisplayFailure("No actual sufficient mode preserves known refresh rate and pixel quality") }
    let aliases = try available(id).filter { $0.ioDisplayModeID == selected.ioDisplayModeID }
    try require(aliases.allSatisfy { NSDictionary(dictionary: modeInfo($0)).isEqual(to: modeInfo(selected)) }, "Selected native mode ID has ambiguous actual properties")
    return selected
}
func settled(_ id: CGDirectDisplayID, _ expected: CGDisplayMode, _ originalFrame: CGRect? = nil, _ originalWorkArea: CGRect? = nil) throws -> [String: Any] {
    let deadline = now() + 5000
    while now() < deadline {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        if let actual = CGDisplayCopyDisplayMode(id), NSDictionary(dictionary: modeInfo(actual)).isEqual(to: modeInfo(expected)) {
            let ns = try screen(id)
            if let frame = originalFrame, let work = originalWorkArea {
                if ns.frame == frame && ns.visibleFrame == work { return try inventory() }
            } else if adequate(ns) && Double(actual.width) == ns.frame.width && Double(actual.height) == ns.frame.height { return try inventory() }
        }
    }
    throw DisplayFailure("Actual native mode/frame/workArea did not settle to the required original or selected state")
}
func ciGuard() throws {
    #if os(macOS) && arch(arm64)
    let env = ProcessInfo.processInfo.environment
    for (key, value) in ["GITHUB_ACTIONS": "true", "CI": "true", "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "macOS", "RUNNER_ARCH": "ARM64"] { try require(env[key] == value, "Ephemeral GitHub-hosted native Mac ARM64 only: " + key) }
    for key in ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"] { try require(env[key]?.range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil, "Actual GitHub run identity required: " + key) }
    #else
    throw DisplayFailure("Only native Darwin ARM64 is supported")
    #endif
}
func session() throws -> Int32 {
    try ciGuard(); try require(CommandLine.arguments.count == 2 && ["--session", "--inventory"].contains(CommandLine.arguments[1]), "Only controlled native session/inventory is allowed")
    _ = NSApplication.shared; NSApp.setActivationPolicy(.prohibited)
    if CommandLine.arguments[1] == "--inventory" { try emit(["event": "inventory", "inventory": try inventory()]); return 0 }
    let id = CGMainDisplayID()
    guard let original = CGDisplayCopyDisplayMode(id) else { throw DisplayFailure("Original main mode unavailable") }
    let ns = try screen(id), originalFrame = ns.frame, originalWorkArea = ns.visibleFrame, originalScale = ns.backingScaleFactor
    let first = try inventory(); try emit(["event": "inventory", "inventory": first])
    var attemptedChange = false, prepared = false, reason = "stdin-eof", failures: [[String: Any]] = []
    do {
        while let line = readLine() {
            guard let command = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any], let name = command["command"] as? String else { throw DisplayFailure("Malformed controlled display command") }
            if name == "restore" { reason = "explicit-restore"; break }
            try require(name == "prepare" && !prepared, "Only one prepare followed by restore is permitted")
            try require((command["displayID"] as? NSNumber)?.uint32Value == id, "Command does not bind the actual main display")
            let selected = try choose(id, original)
            if let mode = selected {
                try require((command["modeID"] as? NSNumber)?.int32Value == mode.ioDisplayModeID, "Command differs from the smallest actual eligible native mode ID")
                // Temporary per-process API; never save a permanent display preference.
                attemptedChange = true
                let result = CGDisplaySetDisplayMode(id, mode, nil)
                try require(result == .success, "CGDisplaySetDisplayMode failed: \(result.rawValue)")
            } else { try require(command["modeID"] is NSNull, "No-op command must not request a mode change") }
            let after = try settled(id, selected ?? original)
            try require(try screen(id).backingScaleFactor >= originalScale, "Actual post-change pixel backing scale fell")
            prepared = true
            try emit(["event": "prepared", "changed": attemptedChange, "selectedMode": selected.map(modeInfo) as Any? ?? NSNull(), "original": first, "after": after, "atUnixMs": now()])
        }
    } catch { reason = "prepare-or-protocol-failure"; failures.append(["stage": "prepare", "message": String(describing: error), "atUnixMs": now()]) }
    do {
        if attemptedChange { let result = CGDisplaySetDisplayMode(id, original, nil); try require(result == .success, "Explicit original mode restoration failed: \(result.rawValue)") }
        let after = try settled(id, original, originalFrame, originalWorkArea)
        try emit(["event": "restored", "pass": true, "reason": reason, "changed": attemptedChange, "original": first, "after": after, "atUnixMs": now()])
    } catch { failures.append(["stage": "restore", "message": String(describing: error), "atUnixMs": now()]); try emit(["event": "restored", "pass": false, "reason": reason, "changed": attemptedChange, "atUnixMs": now()]) }
    for failure in failures { try emit(["event": "native-error", "failure": failure]) }
    return failures.isEmpty ? 0 : 1
}
do { exit(try session()) } catch { try? emit(["event": "native-error", "failure": ["stage": "inventory-or-guard", "message": String(describing: error), "atUnixMs": now()]]); exit(1) }
