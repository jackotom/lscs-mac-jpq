import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

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
  case unsupportedSystem
  case imageEncodingFailed
}

func captureWindow(windowId: CGWindowID, ownerPid: pid_t) async throws -> CGImage {
  guard CGPreflightScreenCaptureAccess() else {
    throw WindowCaptureError.permissionDenied
  }
  guard #available(macOS 14.0, *) else {
    throw WindowCaptureError.unsupportedSystem
  }
  return try await captureWindowWithScreenCaptureKit(windowId: windowId, ownerPid: ownerPid)
}

@available(macOS 14.0, *)
func captureWindowWithScreenCaptureKit(windowId: CGWindowID, ownerPid: pid_t) async throws -> CGImage {
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  guard let window = content.windows.first(where: {
    $0.windowID == windowId && $0.owningApplication?.processID == ownerPid
  }) else {
    throw WindowCaptureError.windowNotFound
  }
  let filter = SCContentFilter(desktopIndependentWindow: window)
  let contentRect = filter.contentRect
  let scale = CGFloat(filter.pointPixelScale)
  guard contentRect.width > 0, contentRect.height > 0, scale > 0 else {
    throw WindowCaptureError.windowNotFound
  }
  let configuration = SCStreamConfiguration()
  configuration.width = Int((contentRect.width * scale).rounded())
  configuration.height = Int((contentRect.height * scale).rounded())
  configuration.showsCursor = false
  return try await SCScreenshotManager.captureImage(
    contentFilter: filter,
    configuration: configuration
  )
}

func writePng(_ image: CGImage) throws {
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
    throw WindowCaptureError.imageEncodingFailed
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw WindowCaptureError.imageEncodingFailed
  }
  FileHandle.standardOutput.write(data as Data)
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
  Task {
    do {
      try writePng(try await captureWindow(windowId: CGWindowID(windowId), ownerPid: ownerPid))
      exit(0)
    } catch {
      exit(1)
    }
  }
  dispatchMain()
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
