// Re-check whether the ChatGPT desktop app exposes its message composer to macOS Accessibility.
// Read-only: it asks the app for its Accessibility tree (resetting the flag afterwards) and lists
// editable text elements. MIKO only inserts text when a composer can be found and verified.
//
//   swiftc -O -o /tmp/probe scripts/probe-chatgpt-composer.swift && /tmp/probe
//
// Needs Accessibility permission for the app running it (Terminal, etc.).
import AppKit
import ApplicationServices

let ids = ["com.openai.chat", "com.openai.codex"]
guard let app = ids.lazy.compactMap({ NSRunningApplication.runningApplications(withBundleIdentifier: $0).first }).first else {
  print("ChatGPT is not running"); exit(1)
}
let ax = AXUIElementCreateApplication(app.processIdentifier)
func attr(_ e: AXUIElement, _ name: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}
for flag in ["AXManualAccessibility", "AXEnhancedUserInterface"] {
  print("\(flag) set ->", AXUIElementSetAttributeValue(ax, flag as CFString, kCFBooleanTrue).rawValue, "(0 = ok)")
}
usleep(1_500_000)
var visited = 0
var editable = 0
func walk(_ e: AXUIElement, _ depth: Int) {
  visited += 1
  if depth > 40 || visited > 20000 { return }
  let role = attr(e, "AXRole") as? String ?? ""
  if role == "AXTextArea" || role == "AXTextField" {
    editable += 1
    print("  \(role) placeholder=\(attr(e, "AXPlaceholderValue") as? String ?? "") description=\(attr(e, "AXDescription") as? String ?? "")")
  }
  for kid in (attr(e, "AXChildren") as? [AXUIElement] ?? []) { walk(kid, depth + 1) }
}
for window in (attr(ax, "AXWindows") as? [AXUIElement] ?? []) { walk(window, 0) }
for flag in ["AXManualAccessibility", "AXEnhancedUserInterface"] {
  _ = AXUIElementSetAttributeValue(ax, flag as CFString, kCFBooleanFalse)
}
print("\(app.localizedName ?? "ChatGPT") \(app.bundleIdentifier ?? ""): visited \(visited) elements, \(editable) editable text elements")
print(editable == 0 ? "Composer NOT exposed: MIKO must copy + focus." : "Text elements found: inspect before enabling insertion.")
