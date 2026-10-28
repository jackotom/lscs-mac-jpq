import AppKit
import CoreGraphics
import Foundation

func resolveFrontmostName(_ workspaceName: String?, frontWindowOwner: String?) -> String? {
  guard let name = workspaceName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
    return nil
  }
  if name.caseInsensitiveCompare("Battle.net") == .orderedSame,
     frontWindowOwner?.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare("Hearthstone") == .orderedSame {
    return "Hearthstone"
  }
  return name
}

func frontNormalWindow() -> [String: Any]? {
  guard let windows = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements],
    kCGNullWindowID
  ) as? [[String: Any]] else {
    return nil
  }

  return windows.first { window in
    guard (window[kCGWindowLayer as String] as? Int) == 0,
          (window[kCGWindowAlpha as String] as? Double ?? 0) > 0,
          let bounds = window[kCGWindowBounds as String] as? [String: Any],
          (bounds["Width"] as? Double ?? 0) >= 200,
          (bounds["Height"] as? Double ?? 0) >= 200 else {
      return false
    }
    return true
  }
}

enum WindowCaptureError: Error {
  case permissionDenied
  case windowNotFound
  case captureFailed
}

func captureWindow(windowId: CGWindowID, ownerPid: pid_t) throws -> Data {
  guard CGPreflightScreenCaptureAccess() else {
    throw WindowCaptureError.permissionDenied
  }
  guard let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, windowId) as? [[String: Any]],
        windows.contains(where: {
          ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == windowId &&
          ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == ownerPid &&
          ($0[kCGWindowOwnerName as String] as? String)?.caseInsensitiveCompare("Hearthstone") == .orderedSame
        }) else {
    throw WindowCaptureError.windowNotFound
  }

  // SCContentFilter(desktopIndependentWindow:) aborts inside SkyLight for Hearthstone.
  // Capture the verified window ID with the system tool; never fall back to the display.
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent("hearthstone-screen-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                        attributes: [.posixPermissions: 0o700])
  defer { try? FileManager.default.removeItem(at: directory) }
  let imageURL = directory.appendingPathComponent("window.png")
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  process.arguments = ["-x", "-o", "-l", String(windowId), imageURL.path]
  try process.run()
  process.waitUntilExit()
  guard process.terminationStatus == 0 else { throw WindowCaptureError.captureFailed }
  let image = try Data(contentsOf: imageURL)
  guard image.starts(with: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) else {
    throw WindowCaptureError.captureFailed
  }
  return image
}

if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--resolve" {
  if let name = resolveFrontmostName(CommandLine.arguments[2], frontWindowOwner: CommandLine.arguments[3]) {
    print(name)
    exit(0)
  }
  exit(1)
}

if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--capture-window",
   let windowId = UInt32(CommandLine.arguments[2]),
   let ownerPid = Int32(CommandLine.arguments[3]), windowId > 0, ownerPid > 0 {
  do {
    FileHandle.standardOutput.write(try captureWindow(windowId: CGWindowID(windowId), ownerPid: ownerPid))
    exit(0)
  } catch {
    exit(1)
  }
}

let frontmostApplication = NSWorkspace.shared.frontmostApplication
let workspaceName = frontmostApplication?.localizedName ?? frontmostApplication?.bundleIdentifier
let frontWindow = frontNormalWindow()
let frontWindowOwner = frontWindow?[kCGWindowOwnerName as String] as? String
if CommandLine.arguments.count == 2, CommandLine.arguments[1] == "--capture-context" {
  guard resolveFrontmostName(workspaceName, frontWindowOwner: frontWindowOwner) == "Hearthstone",
        frontWindowOwner?.caseInsensitiveCompare("Hearthstone") == .orderedSame,
        let window = frontWindow,
        let windowId = window[kCGWindowNumber as String] as? NSNumber,
        let ownerPid = window[kCGWindowOwnerPID as String] as? NSNumber,
        let bounds = window[kCGWindowBounds as String] as? [String: Any],
        let x = bounds["X"] as? NSNumber, let y = bounds["Y"] as? NSNumber,
        let width = bounds["Width"] as? NSNumber, let height = bounds["Height"] as? NSNumber else { exit(1) }
  let context: [String: Any] = [
    "applicationName": "Hearthstone", "windowId": windowId, "ownerPid": ownerPid,
    "bounds": ["x": x, "y": y, "width": width, "height": height]
  ]
  if let data = try? JSONSerialization.data(withJSONObject: context), let json = String(data: data, encoding: .utf8) {
    print(json)
    exit(0)
  }
  exit(1)
}
if let name = resolveFrontmostName(workspaceName, frontWindowOwner: frontWindowOwner) {
  print(name)
  exit(0)
}
exit(1)
