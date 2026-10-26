// QA-only: observe the actual display and owned windows without requesting
// permissions, creating windows, capturing substitute images or changing focus.
import AppKit
import CoreGraphics

func rect(_ value: CGRect) -> [String: Double] {
    ["x": value.origin.x, "y": value.origin.y, "width": value.width, "height": value.height]
}
let owners = Set(CommandLine.arguments.dropFirst().compactMap(Int32.init))
var online = [CGDirectDisplayID](repeating: 0, count: 32)
var active = [CGDirectDisplayID](repeating: 0, count: 32)
var onlineCount: UInt32 = 0, activeCount: UInt32 = 0
let onlineResult = CGGetOnlineDisplayList(32, &online, &onlineCount)
let activeResult = CGGetActiveDisplayList(32, &active, &activeCount)
let onlineIDs = Array(online.prefix(Int(onlineCount)))
let activeIDs = Array(active.prefix(Int(activeCount)))
let displays: [[String: Any]] = Set(onlineIDs + activeIDs).sorted().map { id in
    ["id": id, "main": id == CGMainDisplayID(), "online": CGDisplayIsOnline(id) != 0,
     "active": CGDisplayIsActive(id) != 0, "asleep": CGDisplayIsAsleep(id) != 0,
     "bounds": rect(CGDisplayBounds(id)), "pixelWidth": CGDisplayPixelsWide(id),
     "pixelHeight": CGDisplayPixelsHigh(id)]
}
let onScreen = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let onScreenIDs = Set(onScreen.compactMap { $0[kCGWindowNumber as String] as? UInt32 })
let all = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let windows: [[String: Any]] = all.compactMap { window in
    guard let owner = window[kCGWindowOwnerPID as String] as? Int32, owners.contains(owner),
          let id = window[kCGWindowNumber as String] as? UInt32 else { return nil }
    return ["id": id, "ownerPID": owner, "ownerName": window[kCGWindowOwnerName as String] as? String ?? "",
            "name": window[kCGWindowName as String] as? String ?? "",
            "layer": window[kCGWindowLayer as String] as? Int ?? -1,
            "onScreen": onScreenIDs.contains(id), "bounds": window[kCGWindowBounds as String] ?? [:],
            "alpha": window[kCGWindowAlpha as String] as? Double ?? -1]
}
let result: [String: Any] = ["epochMs": Date().timeIntervalSince1970 * 1000,
    "mainDisplayID": CGMainDisplayID(), "onlineListResult": onlineResult.rawValue,
    "activeListResult": activeResult.rawValue, "displays": displays, "windows": windows,
    "frontPID": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1,
    "screenCaptureAccess": CGPreflightScreenCaptureAccess(),
    "permissionNote": "Preflight for this QA helper/responsible process; no prompt, not a substitute for screencapture result"]
let bytes = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: bytes, encoding: .utf8)!)
