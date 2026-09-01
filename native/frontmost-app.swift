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

func frontNormalWindowOwner() -> String? {
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
  }?[kCGWindowOwnerName as String] as? String
}

if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--resolve" {
  if let name = resolveFrontmostName(CommandLine.arguments[2], frontWindowOwner: CommandLine.arguments[3]) {
    print(name)
    exit(0)
  }
  exit(1)
}

let frontmostApplication = NSWorkspace.shared.frontmostApplication
let workspaceName = frontmostApplication?.localizedName ?? frontmostApplication?.bundleIdentifier
if let name = resolveFrontmostName(workspaceName, frontWindowOwner: frontNormalWindowOwner()) {
  print(name)
  exit(0)
}
exit(1)
