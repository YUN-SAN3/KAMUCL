// Disposable CI QA: exact process creation/executable, actual owned CGWindow,
// frontmost NSWorkspace and real OS events. No permission requests or arguments.
import AppKit
import CoreGraphics
import Darwin
func emit(_ value: [String: Any]) { let bytes = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); FileHandle.standardOutput.write(bytes); FileHandle.standardOutput.write(Data([10])) }
func fail(_ text: String) -> Never { emit(["complete": false, "error": text]); exit(2) }
func identity(_ pid: Int32) -> (String, String)? { var info = proc_bsdinfo(); let size = Int32(MemoryLayout<proc_bsdinfo>.size); guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }; var bytes = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4); guard proc_pidpath(pid, &bytes, UInt32(bytes.count)) > 0 else { return nil }; return (String(info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec), String(cString: bytes)) }
guard CommandLine.arguments.count == 2, let bytes = try? Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])), let request = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any], let pid = request["pid"] as? Int32, pid > 0, let exe = request["executable"] as? String, let before = identity(pid), before.1 == exe, let kind = request["kind"] as? String, ["inspect", "observe", "focus", "key", "click"].contains(kind) else { fail("Exact owned request/identity unavailable") }
if let creation = request["creationUnixUS"] as? String, creation != before.0 { fail("Owned PID creation changed") }
if kind == "inspect" {
    let inventory = (CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter { $0[kCGWindowOwnerPID as String] as? Int32 == pid }
    guard let after = identity(pid), after.0 == before.0, after.1 == before.1 else { fail("Owned identity changed during read-only inventory") }
    emit(["complete": true, "identityStable": true, "creationUnixUS": before.0, "ownerPID": pid, "frontmostPID": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1, "ownedWindowInventory": inventory, "kind": kind, "screenCaptureAccess": CGPreflightScreenCaptureAccess(), "classification": "Read-only owned CGWindow inventory including hidden-window observations; does not qualify foreground input."]); exit(0)
}
func ownedWindow() -> [String: Any] {
    guard let expected = request["bounds"] as? [String: Double], let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { fail("Actual window inventory unavailable") }
    let matches = windows.filter { item in guard item[kCGWindowOwnerPID as String] as? Int32 == pid, item[kCGWindowLayer as String] as? Int == 0, let bounds = item[kCGWindowBounds as String] as? [String: Double] else { return false }; return zip(["X", "Y", "Width", "Height"], ["x", "y", "width", "height"]).allSatisfy { native, name in guard let actual = bounds[native], let value = expected[name] else { return false }; return abs(actual - value) <= 1 } }
    guard matches.count == 1 else { fail("Expected unique actual owned main CGWindow, found \(matches.count)") }; return matches[0]
}
if kind == "focus" { guard NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateIgnoringOtherApps]) == true else { fail("Owned native activation failed") }; let end = Date().timeIntervalSince1970 + 1.8; while NSWorkspace.shared.frontmostApplication?.processIdentifier != pid && Date().timeIntervalSince1970 < end { RunLoop.current.run(until: Date().addingTimeInterval(0.025)) } }
func foreground() { guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { fail("Native foreground belongs to another process") }; guard let current = identity(pid), current.0 == before.0, current.1 == before.1 else { fail("Owned PID reused") }; _ = ownedWindow() }
foreground(); let initial = ownedWindow()
var postedEvents: [[String: Any]] = []
if kind == "key" {
    guard CGPreflightPostEventAccess(), let key = request["key"] as? String, ["-", "0"].contains(key), let source = CGEventSource(stateID: .hidSystemState) else { fail("Native key event permission/source unavailable; no permission requested") }
    let code: CGKeyCode = key == "-" ? 27 : 29
    for (keyCode, down, flags) in [(CGKeyCode(55), true, CGEventFlags.maskCommand), (code, true, CGEventFlags.maskCommand), (code, false, CGEventFlags.maskCommand), (CGKeyCode(55), false, CGEventFlags())] { foreground(); guard let event = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: down) else { fail("Native keyboard event unavailable") }; event.flags = flags; event.postToPid(pid); postedEvents.append(["atUnixMs": Date().timeIntervalSince1970 * 1000, "targetPID": pid, "keyCode": keyCode, "down": down, "flags": flags.rawValue, "classification": "CGEvent.postToPid invoked; receiver acknowledgement is separately required"]) }
}
if kind == "click" {
    guard CGPreflightPostEventAccess(), let css = request["point"] as? [String: Double], let content = request["contentBounds"] as? [String: Double], let zoom = request["zoom"] as? Double, zoom > 0, let x = css["x"], let y = css["y"], let cx = content["x"], let cy = content["y"], let width = content["width"], let height = content["height"], x >= 0, y >= 0, x * zoom < width, y * zoom < height, let source = CGEventSource(stateID: .hidSystemState) else { fail("Owned native point/permission unavailable; no permission requested") }
    let point = CGPoint(x: cx + x * zoom, y: cy + y * zoom)
    for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] { foreground(); guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { fail("Native mouse event unavailable") }; if type != .mouseMoved { event.setIntegerValueField(.mouseEventClickState, value: 1) }; event.postToPid(pid) }
}
foreground(); guard let after = identity(pid), let windowID = initial[kCGWindowNumber as String] as? UInt32 else { fail("Native identity/window unavailable after observation") }
emit(["complete": true, "identityStable": before.0 == after.0 && before.1 == after.1, "creationUnixUS": before.0, "ownerPID": pid, "frontmostPID": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1, "id": windowID, "bounds": initial[kCGWindowBounds as String] ?? [:], "kind": kind, "postedEvents": postedEvents, "postEventAccess": CGPreflightPostEventAccess(), "screenCaptureAccess": CGPreflightScreenCaptureAccess(), "classification": "Original owned macOS process/window/frontmost and native CGEvents. No permission prompts, command lines or foreign input."])
