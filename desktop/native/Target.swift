import AppKit
import CoreGraphics
import CoreServices

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) { print(text) }
}
let args = CommandLine.arguments
// URL ownership belongs to the installed launcher, never the bare Electron runtime.
func urlHandler() -> String {
    guard let url = NSWorkspace.shared.urlForApplication(toOpen: URL(string: "commonplace://show")!) else { return "" }
    return Bundle(url: url)?.bundleIdentifier ?? ""
}
if args.count == 2 && args[1] == "--url-handler" {
    let url = URL(string: "commonplace://show")!
    emit(["handler": urlHandler(), "application": NSWorkspace.shared.urlForApplication(toOpen: url)?.path ?? ""])
    exit(0)
}
if args.count == 3 && args[1] == "--register-opener" {
    let identifier = args[2]
    guard identifier.range(of: "^ai\\.commonplace\\.opener\\.[a-f0-9]{16}$", options: .regularExpression) != nil else {
        emit(["error": "Invalid Nox launcher identifier."]); exit(1)
    }
    let status = LSSetDefaultHandlerForURLScheme("commonplace" as CFString, identifier as CFString)
    guard status == noErr && urlHandler().lowercased() == identifier.lowercased() else {
        emit(["error": "Could not register the Nox link handler.", "status": status]); exit(1)
    }
    emit(["handler": urlHandler()]); exit(0)
}
guard args.count == 4, let x = Double(args[1]), let y = Double(args[2]),
      let companionPID = Int32(args[3]), companionPID > 0 else { emit(["error": "coordinates"]); exit(0) }
let point = CGPoint(x: x, y: y)
// Window geometry and owning process only. No Accessibility API, screenshots, window titles, or permission prompts.
let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let windows = info.filter { window in
    // Ignore only this companion's windows, without hiding them to see beneath.
    guard let ownerPID = window[kCGWindowOwnerPID as String] as? Int32,
          ownerPID != companionPID,
          (window[kCGWindowLayer as String] as? Int) == 0,
          let raw = window[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(dictionaryRepresentation: raw) else { return false }
    return rect.width >= 150 && rect.height >= 100
}
for window in windows {
    guard let raw = window[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(dictionaryRepresentation: raw), rect.contains(point),
          let pid = window[kCGWindowOwnerPID as String] as? Int32 else { continue }
    let app = NSRunningApplication(processIdentifier: pid)
    let owned = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid }
    let ownedBounds = owned.compactMap { entry -> [String: Double]? in
        guard let raw = entry[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: raw) else { return nil }
        return ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
    }
    let count = owned.count
    emit([
        "bundleId": app?.bundleIdentifier ?? "", "pid": pid,
        "launchedAt": (app?.launchDate?.timeIntervalSince1970 ?? 0) * 1000,
        "windowCount": count, "windowBounds": ownedBounds,
        "point": ["x": x, "y": y],
        "bounds": ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
    ])
    exit(0)
}
emit(["error": "no-target", "message": "Move the buddy over an open Codex conversation or Claude Code session."])
