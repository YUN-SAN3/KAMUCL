// QA-only: inspect exactly one PID/creation identity. No signals, focus,
// permission requests, process enumeration, debugger attachment or VM writes.
import AppKit
import CoreGraphics
import ApplicationServices
import Darwin

func emit(_ value: [String: Any]) {
    do {
        let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        FileHandle.standardOutput.write(bytes)
        FileHandle.standardOutput.write(Data([10]))
    } catch { fputs("owned game observer JSON error\n", stderr); exit(2) }
}
func identity(_ pid: Int32) -> [String: Any]? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
    var bytes = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let byteCount = UInt32(bytes.count)
    guard proc_pidpath(pid, &bytes, byteCount) > 0 else { return nil }
    return ["pid": pid, "ppid": info.pbi_ppid,
            "creationUnixUS": String(info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec),
            "executable": String(cString: bytes)]
}
let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2, ["--identity", "--observe", "--alerts"].contains(args[0]),
      let pid = Int32(args[1]), pid > 0 else {
    emit(["complete": false, "error": "exact PID required"]); exit(2)
}
let started = Date().timeIntervalSince1970 * 1000
guard let before = identity(pid) else {
    emit(["complete": false, "pid": pid, "errno": errno,
          "error": "owned process identity unavailable", "startedAtUnixMs": started]); exit(3)
}
if args[0] == "--identity" { emit(before); exit(0) }
guard args.count == 4, before["creationUnixUS"] as? String == args[2],
      before["executable"] as? String == args[3] else {
    emit(["complete": false, "before": before, "error": "PID creation/executable mismatch"]); exit(4)
}
if args[0] == "--alerts" {
    // Exact application's read-only accessibility tree. Trust is queried only;
    // unavailable text is unknown, never a request for Accessibility approval.
    let trusted = AXIsProcessTrusted(), deadline = Date().timeIntervalSince1970 + 1.2
    var rows = [[String: Any]](), visited = Set<CFHashCode>(), errors = [[String: Any]]()
    func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
        guard Date().timeIntervalSince1970 < deadline else { return nil }
        AXUIElementSetMessagingTimeout(element, 0.1)
        var value: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(element, key as CFString, &value)
        if error != .success && error != .noValue && error != .attributeUnsupported {
            if errors.count < 16 { errors.append(["attribute": key, "code": error.rawValue]) }
        }
        return error == .success ? value : nil
    }
    func walk(_ element: AXUIElement, _ depth: Int) {
        guard depth <= 6, rows.count < 128, Date().timeIntervalSince1970 < deadline else { return }
        let key = CFHash(element); guard visited.insert(key).inserted else { return }
        let role = attribute(element, kAXRoleAttribute) as? String ?? ""
        var row: [String: Any] = ["role": role, "depth": depth]
        if ["AXWindow", "AXDialog", "AXSheet", "AXAlert", "AXStaticText", "AXButton"].contains(role) {
            for name in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
                if let value = attribute(element, name) as? String, !value.isEmpty { row[name] = String(value.prefix(4096)) }
            }
        }
        rows.append(row)
        if let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            for child in children.prefix(64) { walk(child, depth + 1) }
        }
    }
    if trusted {
        let app = AXUIElementCreateApplication(pid)
        if let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] { for window in windows.prefix(32) { walk(window, 0) } }
    }
    let after = identity(pid), stable = after?["creationUnixUS"] as? String == args[2] && after?["executable"] as? String == args[3]
    emit(["complete": stable, "before": before, "after": after as Any? ?? NSNull(), "identityStable": stable,
          "accessibilityTrusted": trusted, "textAvailable": !rows.isEmpty, "rows": rows, "readErrors": errors,
          "truncated": rows.count >= 128 || Date().timeIntervalSince1970 >= deadline,
          "startedAtUnixMs": started, "finishedAtUnixMs": Date().timeIntervalSince1970 * 1000,
          "classification": "Exact owned game's read-only AX windows and static alert text. Missing permission/text remains unknown; system-owned dialogs are not attributed to this PID.",
          "permissionNote": "preflight only; no prompt, no focus, no process arguments or text fields"])
    exit(stable ? 0 : 4)
}
let onScreen = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
let all = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
let visibleIDs = Set((onScreen ?? []).compactMap { $0[kCGWindowNumber as String] as? UInt32 })
// CoreGraphics provides a window list; publish only the exact owned PID rows.
let windows: [[String: Any]] = (all ?? []).compactMap { item in
    guard let owner = item[kCGWindowOwnerPID as String] as? Int32, owner == pid,
          let id = item[kCGWindowNumber as String] as? UInt32 else { return nil }
    return ["id": id, "ownerPID": owner, "onScreen": visibleIDs.contains(id),
            "name": item[kCGWindowName as String] as? String ?? "",
            "layer": item[kCGWindowLayer as String] as? Int ?? -1,
            "bounds": item[kCGWindowBounds as String] ?? [:],
            "alpha": item[kCGWindowAlpha as String] as? Double ?? -1]
}
let after = identity(pid)
let stable = after?["creationUnixUS"] as? String == args[2] && after?["executable"] as? String == args[3]
emit(["complete": stable && all != nil && onScreen != nil, "before": before,
      "after": after as Any? ?? NSNull(), "identityStable": stable,
      "startedAtUnixMs": started, "finishedAtUnixMs": Date().timeIntervalSince1970 * 1000,
      "allWindowListAvailable": all != nil, "onScreenWindowListAvailable": onScreen != nil,
      "windows": windows, "screenCaptureAccess": CGPreflightScreenCaptureAccess(),
      "permissionNote": "preflight only; no prompt, no screen capture, no focus change"])
exit(stable ? 0 : 4)
