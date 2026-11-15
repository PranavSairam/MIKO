import AppKit
import ApplicationServices
import CryptoKit
import Foundation

// miko-ax: one-shot Accessibility helper for MIKO (spawned as a child process).
// Reads and writes only the focused text field of the frontmost app, and only
// when MIKO asks. Prints one JSON object. Text to insert arrives on stdin.
//
//   focus-info [--bundle <id>] [--activate <pid>]
//   capture                         selected text (Accessibility, else a deliberate ⌘C with clipboard restore)
//   replace --pid P --sig S --hash H [--method ax|copy]   replace that exact selection with stdin text
//   insert  --pid P [--sig S] [--mode append|replace|selection]  insert stdin text into a verified field
//   paste   --exclude-pid P [--expect-pid P] [--expect-bundles a,b] [--allow-unexposed]
//           paste stdin text into the field focused now (armed paste; unexposed apps only on explicit confirm)
//
// Password fields (AXSecureTextField) are never read or written.

struct Out: Encodable {
    var ok: Bool
    var reason: String = ""
    var pid: Int32 = 0
    var bundle: String = ""
    var app: String = ""
    var role: String = ""
    var editable: Bool = false
    var secure: Bool = false
    var sig: String = ""
    var text: String? = nil
    var hash: String = ""
    var valueLength: Int = -1
    var method: String = ""
    var verified: Bool = false
    var clipboardRestored: Bool = false
    var changeCount: Int = 0
}

func emit(_ out: Out) -> Never {
    let data = (try? JSONEncoder().encode(out)) ?? Data("{\"ok\":false}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    exit(0)
}

func fail(_ reason: String, _ base: Out = Out(ok: false)) -> Never {
    var o = base
    o.ok = false
    o.reason = reason
    emit(o)
}

let args = CommandLine.arguments
func flag(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func attr(_ e: AXUIElement, _ n: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(e, n as CFString, &v) == .success ? v : nil
}

func settable(_ e: AXUIElement, _ n: String) -> Bool {
    var s: DarwinBoolean = false
    return AXUIElementIsAttributeSettable(e, n as CFString, &s) == .success && s.boolValue
}

func sha(_ s: String) -> String {
    SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
}

func frame(_ e: AXUIElement) -> String {
    var p = CGPoint.zero, z = CGSize.zero
    if let v = attr(e, "AXPosition") { AXValueGetValue(v as! AXValue, .cgPoint, &p) }
    if let v = attr(e, "AXSize") { AXValueGetValue(v as! AXValue, .cgSize, &z) }
    return "\(Int(p.x)),\(Int(p.y)),\(Int(z.width)),\(Int(z.height))"
}

let editableRoles: Set<String> = ["AXTextArea", "AXTextField", "AXComboBox", "AXSearchField"]

struct Target {
    let app: NSRunningApplication
    let element: AXUIElement?
    var out: Out
}

/// The frontmost app and its focused element, described. Never reads secure fields.
func focused(pid known: pid_t? = nil) -> Target {
    guard AXIsProcessTrusted() else { fail("MIKO needs Accessibility permission (System Settings → Privacy & Security → Accessibility).") }
    let found = known.flatMap { NSRunningApplication(processIdentifier: $0) } ?? NSWorkspace.shared.frontmostApplication
    guard let app = found else { fail("No app is in front.") }
    if let p = known, !isFrontmost(p) { fail("\(app.localizedName ?? "That app") isn’t in front any more.") }
    var out = Out(ok: true, pid: app.processIdentifier, bundle: app.bundleIdentifier ?? "", app: app.localizedName ?? "App")
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    guard let raw = attr(axApp, "AXFocusedUIElement") else {
        out.reason = "\(out.app) doesn’t expose a focused field to macOS Accessibility."
        return Target(app: app, element: nil, out: out)
    }
    let el = raw as! AXUIElement
    let role = attr(el, "AXRole") as? String ?? ""
    let subrole = attr(el, "AXSubrole") as? String ?? ""
    out.role = role
    out.secure = subrole == "AXSecureTextField" || role == "AXSecureTextField"
    out.editable = !out.secure && (editableRoles.contains(role) || settable(el, "AXSelectedText") || settable(el, "AXValue"))
    out.sig = sha("\(app.processIdentifier)|\(role)|\(subrole)|\(frame(el))|\(attr(el, "AXIdentifier") as? String ?? "")|\(attr(el, "AXDescription") as? String ?? "")")
    if !out.secure, let value = attr(el, "AXValue") as? String { out.valueLength = value.count }
    return Target(app: app, element: el, out: out)
}

// MARK: Clipboard (all items, all types), conditional restore

struct Snapshot { let items: [[NSPasteboard.PasteboardType: Data]] }

func snapshot() -> Snapshot {
    let items = NSPasteboard.general.pasteboardItems ?? []
    return Snapshot(items: items.map { item in
        var d: [NSPasteboard.PasteboardType: Data] = [:]
        for t in item.types { if let v = item.data(forType: t) { d[t] = v } }
        return d
    })
}

/// Restores only if the clipboard still holds MIKO's own write (changeCount unchanged).
func restore(_ s: Snapshot, ifChange expected: Int) -> Bool {
    let delay = Int(ProcessInfo.processInfo.environment["MIKO_AX_RESTORE_DELAY_MS"] ?? "") ?? 0
    if delay > 0 { usleep(useconds_t(delay * 1000)) }
    let pb = NSPasteboard.general
    guard pb.changeCount == expected else { return false }
    pb.clearContents()
    if !s.items.isEmpty {
        let items: [NSPasteboardItem] = s.items.map { d in
            let item = NSPasteboardItem()
            for (t, v) in d { item.setData(v, forType: t) }
            return item
        }
        pb.writeObjects(items)
    }
    return true
}

func key(_ code: CGKeyCode, pid: pid_t) {
    let src = CGEventSource(stateID: .combinedSessionState)
    for down in [true, false] {
        let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
        e?.flags = .maskCommand
        e?.postToPid(pid)
    }
}

/// Deliberate ⌘C in the frontmost app; returns copied text and restores the clipboard if untouched.
func copySelection(pid: pid_t) -> (String?, Bool) {
    let saved = snapshot()
    let pb = NSPasteboard.general
    let before = pb.changeCount
    key(8, pid: pid) // C
    var copied: String? = nil
    for _ in 0..<30 {
        usleep(20_000)
        if pb.changeCount != before { copied = pb.string(forType: .string); break }
    }
    if copied == nil { return (nil, false) }
    return (copied, restore(saved, ifChange: pb.changeCount))
}

/// Live check (NSWorkspace.frontmostApplication doesn't refresh in a helper without a run loop).
func isFrontmost(_ pid: pid_t) -> Bool {
    (attr(AXUIElementCreateApplication(pid), "AXFrontmost") as? Bool) == true
}

func spin(_ seconds: Double) {
    RunLoop.current.run(until: Date().addingTimeInterval(seconds))
}

func activate(_ pid: pid_t) -> Bool {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return false }
    if isFrontmost(pid) { return true }
    // Accessibility's AXFrontmost targets this exact process and works from a background helper
    // (macOS can ignore NSRunningApplication.activate() from a process that isn't active).
    AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), "AXFrontmost" as CFString, kCFBooleanTrue)
    for _ in 0..<40 {
        spin(0.05)
        if isFrontmost(pid) { return true }
    }
    app.activate()
    for _ in 0..<40 {
        spin(0.05)
        if isFrontmost(pid) { return true }
    }
    return false
}

func stdinText() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(decoding: data, as: UTF8.self)
}

/// Insert via Accessibility when the field allows it; verify by reading the value back.
func axInsert(_ el: AXUIElement, _ text: String, mode: String) -> Bool {
    if ProcessInfo.processInfo.environment["MIKO_AX_FORCE_PASTE"] == "1" { return false } // tests only
    if mode == "replace", settable(el, "AXValue") {
        guard AXUIElementSetAttributeValue(el, "AXValue" as CFString, text as CFString) == .success else { return false }
        return (attr(el, "AXValue") as? String) == text
    }
    if mode == "append", settable(el, "AXValue"), let current = attr(el, "AXValue") as? String {
        let next = current.isEmpty ? text : current + (current.hasSuffix("\n") ? "" : "\n") + text
        guard AXUIElementSetAttributeValue(el, "AXValue" as CFString, next as CFString) == .success else { return false }
        return (attr(el, "AXValue") as? String) == next
    }
    guard settable(el, "AXSelectedText") else { return false }
    let before = attr(el, "AXValue") as? String
    guard AXUIElementSetAttributeValue(el, "AXSelectedText" as CFString, text as CFString) == .success else { return false }
    usleep(60_000)
    if let after = attr(el, "AXValue") as? String { return after.contains(text) && after != before }
    return false
}

/// Paste via ⌘V with the clipboard preserved. Verified when the field's value can be read.
func pasteInsert(_ t: Target, _ text: String) -> (Bool, Bool, Bool) {
    let saved = snapshot()
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString(text, forType: .string)
    let ours = pb.changeCount
    let before = t.element.flatMap { attr($0, "AXValue") as? String }
    key(9, pid: t.app.processIdentifier) // V
    usleep(250_000)
    var verified = false
    if let el = t.element, let after = attr(el, "AXValue") as? String { verified = after.contains(text) && after != before }
    let restored = restore(saved, ifChange: ours)
    return (true, verified, restored)
}

// MARK: WhatsApp contacts
// Search lives on TokenizedSearchBar_TextView (its AXValue is the query; the description stays "Search").
// Chat rows are AXButtons in the chat list. Contact search never writes ChatBar_ComposerTextView.
// Reply drafting may set the composer deliberately via whatsapp-insert after the header is rechecked.

let whatsAppBundle = "net.whatsapp.WhatsApp"
var whatsAppStop = false

func cleanAx(_ raw: String) -> String {
    raw.replacingOccurrences(of: "\u{200e}", with: "")
        .replacingOccurrences(of: "\u{200f}", with: "")
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func rowTitle(_ raw: String) -> String {
    let clean = cleanAx(raw)
    guard let regex = try? NSRegularExpression(pattern: ",\\s*\\d+\\s+unread\\b.*$", options: .caseInsensitive) else { return clean }
    let range = NSRange(clean.startIndex..., in: clean)
    guard let match = regex.firstMatch(in: clean, range: range), let hit = Range(match.range, in: clean) else { return clean }
    return cleanAx(String(clean[..<hit.lowerBound]))
}

func sameTitle(_ a: String, _ b: String) -> Bool {
    cleanAx(a).caseInsensitiveCompare(cleanAx(b)) == .orderedSame
}

func whatsApp() -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == whatsAppBundle }
}

func sceneWindow(_ app: NSRunningApplication) -> AXUIElement? {
    let ax = AXUIElementCreateApplication(app.processIdentifier)
    guard let wins = attr(ax, "AXWindows") as? [AXUIElement] else { return nil }
    return wins.first { (attr($0, "AXIdentifier") as? String) == "SceneWindow" }
}

func findAxId(_ e: AXUIElement, _ id: String, _ depth: Int = 0) -> AXUIElement? {
    if depth > 16 { return nil }
    if (attr(e, "AXIdentifier") as? String) == id { return e }
    guard let kids = attr(e, "AXChildren") as? [AXUIElement] else { return nil }
    for kid in kids {
        if let found = findAxId(kid, id, depth + 1) { return found }
    }
    return nil
}

func axText(_ e: AXUIElement, _ name: String) -> String {
    attr(e, name) as? String ?? ""
}

func focusedElement(_ app: NSRunningApplication) -> AXUIElement? {
    guard let raw = attr(AXUIElementCreateApplication(app.processIdentifier), "AXFocusedUIElement") else { return nil }
    return (raw as! AXUIElement)
}

func whatsAppFront(_ app: NSRunningApplication) -> Bool {
    // NSWorkspace.frontmostApplication stays stale in a short helper. AXFrontmost is the live check.
    isFrontmost(app.processIdentifier)
}

struct WhatsAppRow: Encodable {
    var name: String
    var snippet: String
}

struct WhatsAppMessage: Encodable {
    var sender: String
    var text: String
    var mine: Bool
    var raw: String
}

struct WhatsAppOut: Encodable {
    var ok: Bool
    var status: String
    var query: String = ""
    var reason: String = ""
    var header: String = ""
    var rows: [WhatsAppRow] = []
    var messages: [WhatsAppMessage] = []
    var inspected: Bool = false
    var composerReady: Bool = false
    var composerText: String = ""
    var searchValue: String = ""
    var verified: Bool = false
    /// State/roles only — never message bodies.
    var diag: String = ""
    var atLatest: Bool = true
}

struct WhatsAppIn: Decodable {
    var search: String?
    var name: String?
    var snippet: String?
    var expectHeader: String?
    var text: String?
    var mode: String?
    /// When true, skip clearing/retyping if the search field already holds the query (second step of open).
    var reuseSearch: Bool?
}

func emitWhatsApp(_ out: WhatsAppOut) -> Never {
    let data = (try? JSONEncoder().encode(out)) ?? Data("{\"ok\":false,\"status\":\"failed\"}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    exit(0)
}

func armWhatsAppCancel() {
    signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    source.setEventHandler { whatsAppStop = true }
    source.resume()
}

func pressSearchMenu(_ app: NSRunningApplication) -> Bool {
    let ax = AXUIElementCreateApplication(app.processIdentifier)
    guard let bar = attr(ax, "AXMenuBar") else { return false }
    guard let menus = attr(bar as! AXUIElement, "AXChildren") as? [AXUIElement] else { return false }
    for menu in menus where cleanAx(axText(menu, "AXTitle")) == "File" {
        guard let items = attr(menu, "AXChildren") as? [AXUIElement] else { continue }
        for item in items {
            let kids = (attr(item, "AXChildren") as? [AXUIElement]) ?? [item]
            for kid in kids where cleanAx(axText(kid, "AXTitle")) == "Search" {
                return AXUIElementPerformAction(kid, "AXPress" as CFString) == .success
            }
        }
    }
    return false
}

func clickSearch(_ search: AXUIElement) {
    var p = CGPoint.zero, z = CGSize.zero
    if let v = attr(search, "AXPosition") { AXValueGetValue(v as! AXValue, .cgPoint, &p) }
    if let v = attr(search, "AXSize") { AXValueGetValue(v as! AXValue, .cgSize, &z) }
    let point = CGPoint(x: p.x + z.width / 2, y: p.y + z.height / 2)
    let src = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
    let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
    down?.post(tap: .cghidEventTap)
    usleep(40_000)
    up?.post(tap: .cghidEventTap)
}

func focusSearch(_ app: NSRunningApplication, _ window: AXUIElement) -> AXUIElement? {
    func searchEl() -> AXUIElement? {
        guard let win = sceneWindow(app) else { return nil }
        return findAxId(win, "TokenizedSearchBar_TextView")
    }
    func focusedSearch() -> Bool {
        guard let el = focusedElement(app) else { return false }
        return axText(el, "AXIdentifier") == "TokenizedSearchBar_TextView"
    }
    if !focusedSearch() { _ = pressSearchMenu(app); spin(0.25) }
    if !focusedSearch(), let search = searchEl() {
        _ = AXUIElementPerformAction(search, "AXPress" as CFString)
        spin(0.2)
    }
    if !focusedSearch(), let search = searchEl() {
        if !whatsAppFront(app) { return nil }
        clickSearch(search)
        spin(0.25)
    }
    guard let el = focusedElement(app) else { return nil }
    if axText(el, "AXIdentifier") == "ChatBar_ComposerTextView" { return nil }
    return axText(el, "AXIdentifier") == "TokenizedSearchBar_TextView" ? searchEl() ?? window : nil
}

func keyStroke(_ code: CGKeyCode, flags: CGEventFlags = []) {
    let src = CGEventSource(stateID: .hidSystemState)
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
        event?.flags = flags
        event?.post(tap: .cghidEventTap)
        usleep(20_000)
    }
}

/// Dismiss the search chrome (media filter chips) without typing. Escape only while search is focused.
func dismissSearch(_ app: NSRunningApplication) {
    guard whatsAppFront(app), let el = focusedElement(app), axText(el, "AXIdentifier") == "TokenizedSearchBar_TextView" else { return }
    keyStroke(53) // Escape
    spin(0.15)
}

/// The clear button reports success without deleting. Select-all and delete, only while search is focused.
/// When the field is already empty, do not open File → Search (that leaves Photos/GIFs filter chips up).
func clearSearch(_ app: NSRunningApplication) {
    guard whatsAppFront(app), let win = sceneWindow(app), let search = findAxId(win, "TokenizedSearchBar_TextView") else { return }
    let value = cleanAx(axText(search, "AXValue"))
    if value.isEmpty {
        if let el = focusedElement(app), axText(el, "AXIdentifier") == "TokenizedSearchBar_TextView" { dismissSearch(app) }
        return
    }
    guard focusSearch(app, win) != nil else { return }
    guard let el = focusedElement(app), axText(el, "AXIdentifier") == "TokenizedSearchBar_TextView" else { return }
    keyStroke(0, flags: .maskCommand) // A
    guard let still = focusedElement(app), axText(still, "AXIdentifier") == "TokenizedSearchBar_TextView" else { return }
    keyStroke(51) // delete
    spin(0.15)
    dismissSearch(app)
}

func typeIntoSearch(_ text: String, _ app: NSRunningApplication) -> Bool {
    let src = CGEventSource(stateID: .hidSystemState)
    for ch in text {
        if whatsAppStop || !whatsAppFront(app) { return false }
        guard let el = focusedElement(app) else { return false }
        let id = axText(el, "AXIdentifier")
        if id == "ChatBar_ComposerTextView" { return false }
        if id != "TokenizedSearchBar_TextView" { return false }
        var units = Array(String(ch).utf16)
        let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
        down?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
        down?.post(tap: .cghidEventTap)
        usleep(18_000)
        let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
        up?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
        up?.post(tap: .cghidEventTap)
        usleep(14_000)
    }
    return true
}

func searchValue(_ app: NSRunningApplication) -> String {
    guard let win = sceneWindow(app), let search = findAxId(win, "TokenizedSearchBar_TextView") else { return "" }
    return cleanAx(axText(search, "AXValue"))
}

/// Filtered hits use ChatListSearchView_ChatResult. The ordinary chat list stays in the tree and is ignored.
/// AXValue is the last-message preview; together with the name it distinguishes same-named chats.
func searchRows(_ window: AXUIElement) -> (rows: [WhatsAppRow], none: Bool, ready: Bool) {
    var rows: [WhatsAppRow] = []
    var none = false
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 16 || rows.count >= 12 { return }
        let desc = axText(e, "AXDescription")
        if axText(e, "AXRole") == "AXStaticText" && cleanAx(desc).caseInsensitiveCompare("No results") == .orderedSame { none = true }
        if axText(e, "AXIdentifier").hasPrefix("ChatListSearchView_ChatResult") {
            let name = rowTitle(desc)
            if !name.isEmpty {
                let snippet = String(cleanAx(axText(e, "AXValue")).prefix(120))
                rows.append(WhatsAppRow(name: name, snippet: snippet))
            }
        }
        guard let kids = attr(e, "AXChildren") as? [AXUIElement] else { return }
        for kid in kids { walk(kid, depth + 1) }
    }
    walk(window, 0)
    if none { return ([], true, true) }
    return (rows, false, !rows.isEmpty)
}

func findDescribed(_ e: AXUIElement, _ needle: String, _ depth: Int = 0) -> AXUIElement? {
    if depth > 16 { return nil }
    if cleanAx(axText(e, "AXDescription")).caseInsensitiveCompare(needle) == .orderedSame { return e }
    guard let kids = attr(e, "AXChildren") as? [AXUIElement] else { return nil }
    for kid in kids {
        if let found = findDescribed(kid, needle, depth + 1) { return found }
    }
    return nil
}

func pressRow(_ window: AXUIElement, _ name: String, _ snippet: String) -> Bool {
    var pressed = false
    var matches = 0
    var target: AXUIElement?
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 16 { return }
        if axText(e, "AXIdentifier").hasPrefix("ChatListSearchView_ChatResult") && sameTitle(rowTitle(axText(e, "AXDescription")), name) {
            let rowSnippet = String(cleanAx(axText(e, "AXValue")).prefix(120))
            if snippet.isEmpty || sameTitle(rowSnippet, snippet) || cleanAx(rowSnippet).localizedCaseInsensitiveContains(cleanAx(snippet)) || cleanAx(snippet).localizedCaseInsensitiveContains(cleanAx(rowSnippet)) {
                matches += 1
                target = e
            }
        }
        guard let kids = attr(e, "AXChildren") as? [AXUIElement] else { return }
        for kid in kids { walk(kid, depth + 1) }
    }
    walk(window, 0)
    // Only press when exactly one row matches name+snippet. Duplicates stay for the user in WhatsApp.
    guard matches == 1, let el = target else { return false }
    pressed = AXUIElementPerformAction(el, "AXPress" as CFString) == .success
    return pressed
}

func confirmedHeader(_ window: AXUIElement, _ name: String) -> String {
    let minX = findAxId(window, "ChatListView_TableView").map { frameRect($0).maxX - 8 } ?? 500
    var found = ""
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 16 || !found.isEmpty { return }
        let desc = cleanAx(axText(e, "AXDescription"))
        let title = cleanAx(axText(e, "AXTitle"))
        let rect = frameRect(e)
        let label = sameTitle(desc, name) ? desc : (sameTitle(title, name) ? title : "")
        let id = axText(e, "AXIdentifier")
        // The open chat's name is NavigationBar_HeaderViewButton, to the right of the chat list.
        if !label.isEmpty && rect.minX >= minX && rect.minY < 160 && rect.height > 8 && rect.height < 80 && !id.hasPrefix("ChatListSearchView_") {
            found = label
        }
        guard let kids = attr(e, "AXChildren") as? [AXUIElement] else { return }
        for kid in kids { walk(kid, depth + 1) }
    }
    walk(window, 0)
    return found
}

func frameRect(_ e: AXUIElement) -> CGRect {
    var p = CGPoint.zero, z = CGSize.zero
    if let v = attr(e, "AXPosition") { AXValueGetValue(v as! AXValue, .cgPoint, &p) }
    if let v = attr(e, "AXSize") { AXValueGetValue(v as! AXValue, .cgSize, &z) }
    return CGRect(origin: p, size: z)
}

func focusComposer(_ app: NSRunningApplication) -> Bool {
    guard whatsAppFront(app), let win = sceneWindow(app), let composer = findAxId(win, "ChatBar_ComposerTextView") else { return false }
    let before = axText(composer, "AXValue")
    let pressed = AXUIElementPerformAction(composer, "AXPress" as CFString) == .success
    AXUIElementSetAttributeValue(composer, "AXFocused" as CFString, kCFBooleanTrue)
    spin(0.35)
    guard axText(composer, "AXValue") == before else { return false }
    if let el = focusedElement(app), axText(el, "AXIdentifier") == "ChatBar_ComposerTextView" { return true }
    return pressed
}

func currentHeader(_ window: AXUIElement) -> String {
    guard let button = findAxId(window, "NavigationBar_HeaderViewButton") else { return "" }
    return cleanAx(axText(button, "AXDescription"))
}

func composerInfo(_ window: AXUIElement) -> (text: String, ready: Bool) {
    guard let composer = findAxId(window, "ChatBar_ComposerTextView") else { return ("", false) }
    return (axText(composer, "AXValue"), true)
}

func isSkippableBubble(_ raw: String) -> Bool {
    let clean = cleanAx(raw)
    if clean.isEmpty { return true }
    // Media, cards, and controls — not usable as reply context.
    if let re = try? NSRegularExpression(pattern: "^(Your )?(photo|video|GIF|sticker|contact|document|audio|voice message|poll|event|location)\\b", options: .caseInsensitive),
       re.firstMatch(in: clean, range: NSRange(clean.startIndex..., in: clean)) != nil {
        return true
    }
    if clean.range(of: "Double tap", options: .caseInsensitive) != nil { return true }
    return false
}

/// Visible text bubbles in ChatMessagesTableView only (not the sidebar chat list).
func visibleMessages(_ window: AXUIElement, _ chatName: String) -> (messages: [WhatsAppMessage], atLatest: Bool) {
    guard let table = findAxId(window, "ChatMessagesTableView") else { return ([], true) }
    var rows: [WhatsAppMessage] = []
    var sawToday = false
    var sawOlderLabel = false
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 12 || rows.count >= 12 { return }
        let id = axText(e, "AXIdentifier")
        let desc = cleanAx(axText(e, "AXDescription"))
        if axText(e, "AXRole") == "AXStaticText", id.isEmpty {
            if desc.caseInsensitiveCompare("Today") == .orderedSame { sawToday = true }
            else if desc.range(of: #"^(Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}\s+\w+|\w+\s+\d{1,2})"#, options: .regularExpression) != nil {
                sawOlderLabel = true
            }
        }
        if id == "WAMessageBubbleTableViewCell" {
            let raw = cleanAx(axText(e, "AXDescription"))
            if !isSkippableBubble(raw), let parsed = parseBubble(raw, chatName) { rows.append(parsed) }
        }
        guard let kids = attr(e, "AXChildren") as? [AXUIElement] else { return }
        for kid in kids { walk(kid, depth + 1) }
    }
    walk(table, 0)
    let atLatest = sawToday || !sawOlderLabel
    return (rows, atLatest)
}

/// Scroll the conversation so the newest messages are visible (composer side).
func scrollChatToLatest(_ app: NSRunningApplication, _ window: AXUIElement) -> Bool {
    guard let table = findAxId(window, "ChatMessagesTableView") else { return false }
    // Prefer focusing the composer — WhatsApp typically scrolls to the latest then.
    if focusComposer(app) { spin(0.25); return true }
    _ = AXUIElementPerformAction(table, "AXPress" as CFString)
    AXUIElementSetAttributeValue(table, "AXFocused" as CFString, kCFBooleanTrue)
    spin(0.1)
    keyStroke(119) // End
    spin(0.2)
    return focusComposer(app)
}

func parseBubble(_ raw: String, _ chatName: String) -> WhatsAppMessage? {
    let clean = cleanAx(raw)
    if clean.isEmpty { return nil }
    if let re = try? NSRegularExpression(pattern: "^(today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b", options: .caseInsensitive),
       re.firstMatch(in: clean, range: NSRange(clean.startIndex..., in: clean)) != nil, clean.count < 24 {
        return nil
    }
    let mine = clean.range(of: "Your message,", options: [.caseInsensitive, .anchored]) != nil
    var body = clean
    if mine { body = String(body.drop(while: { $0 != "," }).dropFirst()).trimmingCharacters(in: .whitespaces) }
    else if body.range(of: "message,", options: [.caseInsensitive, .anchored]) != nil {
        body = String(body.drop(while: { $0 != "," }).dropFirst()).trimmingCharacters(in: .whitespaces)
    }
    if let re = try? NSRegularExpression(pattern: ",\\s*(?:Received from|Sent to|Received in)\\s+[^,]+(?:,\\s*(?:Red|Blue|Grey|Gray|Muted|Pinned))?$", options: .caseInsensitive) {
        body = re.stringByReplacingMatches(in: body, range: NSRange(body.startIndex..., in: body), withTemplate: "")
    }
    if let re = try? NSRegularExpression(pattern: ",\\s*\\d{1,2}:\\d{2}\\s*(?:AM|PM)?(?:,.*)?$", options: .caseInsensitive) {
        body = re.stringByReplacingMatches(in: body, range: NSRange(body.startIndex..., in: body), withTemplate: "")
    }
    if let re = try? NSRegularExpression(pattern: ",\\s*(?:\\d{1,2}\\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\\b.*$", options: .caseInsensitive) {
        body = re.stringByReplacingMatches(in: body, range: NSRange(body.startIndex..., in: body), withTemplate: "")
    }
    body = cleanAx(body)
    if body.isEmpty { return nil }
    var sender = chatName.isEmpty ? "Contact" : chatName
    if mine { sender = "You" }
    else if let re = try? NSRegularExpression(pattern: "Received from\\s+(.+?)(?:,|$)", options: .caseInsensitive),
            let m = re.firstMatch(in: clean, range: NSRange(clean.startIndex..., in: clean)),
            let r = Range(m.range(at: 1), in: clean) {
        sender = cleanAx(String(clean[r]))
    } else if let re = try? NSRegularExpression(pattern: "Received in\\s+(.+?)(?:,|$)", options: .caseInsensitive),
              let m = re.firstMatch(in: clean, range: NSRange(clean.startIndex..., in: clean)),
              let r = Range(m.range(at: 1), in: clean) {
        sender = cleanAx(String(clean[r]))
    }
    return WhatsAppMessage(sender: sender, text: String(body.prefix(500)), mine: mine, raw: String(clean.prefix(600)))
}

// MARK: - Attachments (visible document bubbles only)

struct AttachmentItem: Encodable {
    var id: String
    var filename: String
    var kind: String
    var detail: String
    var time: String
    var mine: Bool
    var raw: String
}

struct AttachmentOut: Encodable {
    var ok: Bool
    var status: String
    var reason: String = ""
    var header: String = ""
    var attachments: [AttachmentItem] = []
    var atLatest: Bool = true
    var visibleOnly: Bool = true
    var path: String = ""
    var filename: String = ""
    var bytes: Int = 0
    var verified: Bool = false
    var composerText: String = ""
    var composerReady: Bool = false
    var diag: String = ""
}

struct AttachmentIn: Decodable {
    var expectHeader: String?
    var filename: String?
    var id: String?
    var path: String?
}

func emitAttachment(_ out: AttachmentOut) -> Never {
    let data = (try? JSONEncoder().encode(out)) ?? Data("{\"ok\":false,\"status\":\"failed\"}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    exit(0)
}

func attachmentId(_ raw: String) -> String {
    var h: UInt32 = 2166136261
    for b in raw.utf8 {
        h ^= UInt32(b)
        h = h &* 16777619
    }
    return String(format: "att-%08x", h)
}

func parseAttachmentBubble(_ raw: String) -> AttachmentItem? {
    let clean = cleanAx(raw.replacingOccurrences(of: "\u{200e}", with: ""))
    if clean.isEmpty { return nil }
    if let re = try? NSRegularExpression(pattern: "^(Your )?(photo|video|GIF|sticker|contact|audio|voice message|poll|event|location)\\b", options: .caseInsensitive),
       re.firstMatch(in: clean, range: NSRange(clean.startIndex..., in: clean)) != nil {
        return nil
    }
    let isDoc = clean.range(of: #"^(Your )?Document\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    let hasExt = clean.range(of: #"\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    guard isDoc || hasExt else { return nil }
    let mine = clean.range(of: #"^Your Document\b"#, options: [.regularExpression, .caseInsensitive]) != nil
        || clean.range(of: #"Sent to\s+"#, options: [.regularExpression, .caseInsensitive]) != nil
    var filename = ""
    var detail = ""
    var time = ""
    for part in clean.split(separator: ",").map({ cleanAx(String($0)) }) {
        if part.range(of: #"^(Your )?Document$"#, options: [.regularExpression, .caseInsensitive]) != nil { continue }
        if part.range(of: #"Received from|Sent to|Received in"#, options: [.regularExpression, .caseInsensitive]) != nil { continue }
        if part.range(of: #"^(Red|Blue|Grey|Gray|Muted|Pinned)$"#, options: [.regularExpression, .caseInsensitive]) != nil { continue }
        if part.range(of: #"\.[A-Za-z0-9]{2,5}$"#, options: .regularExpression) != nil, filename.isEmpty {
            filename = part
            continue
        }
        if part.range(of: #"\d{1,2}:\d{2}"#, options: .regularExpression) != nil || part.range(of: #"(AM|PM)$"#, options: [.regularExpression, .caseInsensitive]) != nil {
            time = part
            continue
        }
        if part.range(of: #"pages?|KB|MB|GB"#, options: [.regularExpression, .caseInsensitive]) != nil {
            detail = part
            continue
        }
    }
    if filename.isEmpty {
        if let re = try? NSRegularExpression(pattern: #"([\w .()\[\]_-]+\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|zip))"#, options: .caseInsensitive),
           let m = re.firstMatch(in: clean, range: NSRange(clean.startIndex..., in: clean)),
           let r = Range(m.range(at: 1), in: clean) {
            filename = String(clean[r])
        }
    }
    guard !filename.isEmpty else { return nil }
    let kind = (filename as NSString).pathExtension.lowercased()
    return AttachmentItem(
        id: attachmentId("\(mine ? "out" : "in")|\(filename)|\(time)|\(detail)|\(String(clean.prefix(80)))"),
        filename: String(filename.prefix(180)),
        kind: kind.isEmpty ? "file" : kind,
        detail: String(detail.prefix(80)),
        time: String(time.prefix(40)),
        mine: mine,
        raw: String(clean.prefix(600))
    )
}

func visibleAttachments(_ window: AXUIElement) -> (items: [AttachmentItem], atLatest: Bool) {
    guard let table = findAxId(window, "ChatMessagesTableView") else { return ([], true) }
    var items: [AttachmentItem] = []
    var sawToday = false
    var sawOlder = false
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 14 || items.count >= 24 { return }
        let id = axText(e, "AXIdentifier")
        let desc = cleanAx(axText(e, "AXDescription"))
        if axText(e, "AXRole") == "AXStaticText", id.isEmpty {
            if desc.caseInsensitiveCompare("Today") == .orderedSame { sawToday = true }
            else if desc.range(of: #"^(Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)"#, options: .regularExpression) != nil {
                sawOlder = true
            }
        }
        if id == "WAMessageBubbleTableViewCell", let item = parseAttachmentBubble(desc) {
            items.append(item)
        }
        if let kids = attr(e, "AXChildren") as? [AXUIElement] {
            for kid in kids { walk(kid, depth + 1) }
        }
    }
    walk(table, 0)
    return (items, sawToday || !sawOlder)
}

func findAttachmentCell(_ window: AXUIElement, filename: String, id: String?) -> AXUIElement? {
    guard let table = findAxId(window, "ChatMessagesTableView") else { return nil }
    var match: AXUIElement?
    let needle = filename.lowercased()
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 14 || match != nil { return }
        if axText(e, "AXIdentifier") == "WAMessageBubbleTableViewCell" {
            let desc = cleanAx(axText(e, "AXDescription").replacingOccurrences(of: "\u{200e}", with: ""))
            if let parsed = parseAttachmentBubble(desc) {
                if let id, !id.isEmpty, parsed.id == id { match = e; return }
                if parsed.filename.lowercased() == needle || desc.lowercased().contains(needle) { match = e; return }
            }
        }
        if let kids = attr(e, "AXChildren") as? [AXUIElement] {
            for kid in kids { walk(kid, depth + 1) }
        }
    }
    walk(table, 0)
    return match
}

func findMenuItem(_ root: AXUIElement, titled want: String) -> AXUIElement? {
    var found: AXUIElement?
    let target = want.lowercased()
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 12 || found != nil { return }
        if axText(e, "AXRole") == "AXMenuItem" {
            let title = cleanAx(axText(e, "AXTitle").replacingOccurrences(of: "\u{200e}", with: "")).lowercased()
            if title == target || title.contains(target) { found = e; return }
        }
        if let kids = attr(e, "AXChildren") as? [AXUIElement] {
            for kid in kids { walk(kid, depth + 1) }
        }
    }
    walk(root, 0)
    return found
}

func findRole(_ root: AXUIElement, _ role: String, _ depth: Int = 0) -> AXUIElement? {
    if depth > 14 { return nil }
    if axText(root, "AXRole") == role { return root }
    guard let kids = attr(root, "AXChildren") as? [AXUIElement] else { return nil }
    for kid in kids {
        if let found = findRole(kid, role, depth + 1) { return found }
    }
    return nil
}

func findButton(_ root: AXUIElement, titled want: String) -> AXUIElement? {
    var found: AXUIElement?
    let target = want.lowercased()
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 12 || found != nil { return }
        if axText(e, "AXRole") == "AXButton" {
            let title = cleanAx(axText(e, "AXTitle").replacingOccurrences(of: "\u{200e}", with: "")).lowercased()
            if title == target || title.contains(target) { found = e; return }
        }
        if let kids = attr(e, "AXChildren") as? [AXUIElement] {
            for kid in kids { walk(kid, depth + 1) }
        }
    }
    walk(root, 0)
    return found
}

func axSubtreeText(_ root: AXUIElement) -> String {
    var parts: [String] = []
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 10 || parts.count > 40 { return }
        for name in ["AXTitle", "AXDescription", "AXValue"] {
            let t = cleanAx(axText(e, name).replacingOccurrences(of: "\u{200e}", with: ""))
            if !t.isEmpty { parts.append(t) }
        }
        if let kids = attr(e, "AXChildren") as? [AXUIElement] {
            for kid in kids { walk(kid, depth + 1) }
        }
    }
    walk(root, 0)
    return parts.joined(separator: " ")
}

func downloadsDir() -> String {
    NSString(string: "~/Downloads").expandingTildeInPath
}

func runWhatsAppAttachments() -> Never {
    armWhatsAppCancel()
    guard AXIsProcessTrusted() else {
        emitAttachment(AttachmentOut(ok: false, status: "permission", reason: "MIKO needs Accessibility permission (System Settings → Privacy & Security → Accessibility)."))
    }
    guard let app = whatsApp() else { emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "WhatsApp isn’t open.")) }
    if !whatsAppFront(app) { _ = activate(app.processIdentifier); spin(0.35) }
    if whatsAppStop { emitAttachment(AttachmentOut(ok: false, status: "cancelled", reason: "Cancelled.")) }
    guard whatsAppFront(app), let win = sceneWindow(app) else {
        emitAttachment(AttachmentOut(ok: false, status: "lost-focus", reason: "WhatsApp isn’t in front, so I couldn’t list attachments."))
    }
    let header = currentHeader(win)
    guard !header.isEmpty else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "I couldn’t read the open WhatsApp chat header."))
    }
    let found = visibleAttachments(win)
    emitAttachment(AttachmentOut(
        ok: true,
        status: "listed",
        header: header,
        attachments: found.items,
        atLatest: found.atLatest,
        visibleOnly: true,
        composerText: String(composerInfo(win).text.prefix(4000)),
        composerReady: composerInfo(win).ready,
        diag: "header=\(header) attachments=\(found.items.count) atLatest=\(found.atLatest) visibleOnly=true"
    ))
}

func runWhatsAppAttachmentSave() -> Never {
    armWhatsAppCancel()
    let raw = stdinText()
    guard let data = raw.data(using: .utf8), let decoded = try? JSONDecoder().decode(AttachmentIn.self, from: data) else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "That attachment isn’t one I can save."))
    }
    let expect = cleanAx(decoded.expectHeader ?? "")
    let filename = cleanAx(decoded.filename ?? "")
    let id = cleanAx(decoded.id ?? "")
    guard !expect.isEmpty, !filename.isEmpty else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "That attachment isn’t one I can save."))
    }
    guard AXIsProcessTrusted() else {
        emitAttachment(AttachmentOut(ok: false, status: "permission", reason: "MIKO needs Accessibility permission (System Settings → Privacy & Security → Accessibility)."))
    }
    guard let app = whatsApp() else { emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "WhatsApp isn’t open.")) }
    if !whatsAppFront(app) { _ = activate(app.processIdentifier); spin(0.35) }
    if whatsAppStop { emitAttachment(AttachmentOut(ok: false, status: "cancelled", reason: "Cancelled.")) }
    guard whatsAppFront(app), let win = sceneWindow(app) else {
        emitAttachment(AttachmentOut(ok: false, status: "lost-focus", reason: "WhatsApp isn’t in front, so I didn’t download."))
    }
    let header = currentHeader(win)
    if header.isEmpty || !sameTitle(header, expect) {
        emitAttachment(AttachmentOut(ok: false, status: "switched", reason: "The open WhatsApp chat is no longer “\(expect)”.", header: header))
    }
    guard let cell = findAttachmentCell(win, filename: filename, id: id.isEmpty ? nil : id) else {
        emitAttachment(AttachmentOut(ok: false, status: "missing", reason: "I couldn’t find that attachment in the visible messages.", header: header, visibleOnly: true))
    }
    let dl = downloadsDir()
    let fm = FileManager.default
    let before = Set((try? fm.contentsOfDirectory(atPath: dl)) ?? [])
    _ = AXUIElementPerformAction(cell, "AXShowMenu" as CFString)
    spin(0.55)
    if whatsAppStop { emitAttachment(AttachmentOut(ok: false, status: "cancelled", reason: "Cancelled.", header: header)) }
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    // Prefer exact Save to Downloads; never invent a download path outside WhatsApp’s UI.
    var menuTitles: [String] = []
    func collectMenus(_ e: AXUIElement, _ depth: Int) {
        if depth > 10 || menuTitles.count > 40 { return }
        if axText(e, "AXRole") == "AXMenuItem" {
            let t = cleanAx(axText(e, "AXTitle").replacingOccurrences(of: "\u{200e}", with: ""))
            if !t.isEmpty { menuTitles.append(t) }
        }
        if let kids = attr(e, "AXChildren") as? [AXUIElement] {
            for kid in kids { collectMenus(kid, depth + 1) }
        }
    }
    collectMenus(axApp, 0)
    guard let save = findMenuItem(axApp, titled: "Save to Downloads") else {
        _ = AXUIElementPerformAction(cell, "AXCancel" as CFString)
        let shown = menuTitles.prefix(12).joined(separator: " | ")
        emitAttachment(AttachmentOut(
            ok: false,
            status: "unsupported",
            reason: "WhatsApp didn’t offer “Save to Downloads” for that attachment.",
            header: header,
            visibleOnly: true,
            diag: "menus=\(shown)"
        ))
    }
    let pressed = AXUIElementPerformAction(save, "AXPress" as CFString) == .success
    if !pressed {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "I couldn’t choose “Save to Downloads”.", header: header, diag: "menus=\(menuTitles.prefix(8).joined(separator: " | "))"))
    }
    spin(0.5)
    // WhatsApp may ask: “This file has been recently saved… save it again?” — handle that sheet.
    // Press Save for a fresh Downloads write (proven). Never leave the sheet up (it hides the chat header).
    if let sheet = findRole(win, "AXSheet") ?? findRole(AXUIElementCreateApplication(app.processIdentifier), "AXSheet") {
        let sheetText = axSubtreeText(sheet)
        if sheetText.range(of: "save it again", options: .caseInsensitive) != nil || sheetText.range(of: "recently saved", options: .caseInsensitive) != nil {
            if let again = findButton(sheet, titled: "Save") {
                _ = AXUIElementPerformAction(again, "AXPress" as CFString)
                spin(0.45)
            } else if let cancel = findButton(sheet, titled: "Cancel") {
                _ = AXUIElementPerformAction(cancel, "AXPress" as CFString)
                spin(0.3)
                emitAttachment(AttachmentOut(
                    ok: false,
                    status: "candidate",
                    reason: "WhatsApp says this file was recently saved to Downloads. I cancelled the re-save prompt — choose the existing Downloads candidate, or ask me to save again.",
                    header: header,
                    visibleOnly: true,
                    path: (dl as NSString).appendingPathComponent(filename),
                    filename: filename,
                    verified: false,
                    diag: "sheet=save-again cancelled"
                ))
            }
        } else {
            // Unknown sheet — cancel so the chat stays usable.
            if let cancel = findButton(sheet, titled: "Cancel") {
                _ = AXUIElementPerformAction(cancel, "AXPress" as CFString)
            } else {
                keyStroke(53) // Escape
            }
            spin(0.3)
        }
    }
    // Wait for a new nonempty file matching the name (or Name (n).ext). Also notice mtime bumps.
    let stem = (filename as NSString).deletingPathExtension
    let ext = (filename as NSString).pathExtension
    var priorMtimes: [String: Date] = [:]
    for name in before {
        let full = (dl as NSString).appendingPathComponent(name)
        if let attrs = try? fm.attributesOfItem(atPath: full), let m = attrs[.modificationDate] as? Date {
            priorMtimes[name] = m
        }
    }
    var path = ""
    var bytes = 0
    for _ in 0..<60 {
        if whatsAppStop { emitAttachment(AttachmentOut(ok: false, status: "cancelled", reason: "Cancelled after download started — check Downloads.", header: header)) }
        spin(0.4)
        let after = Set((try? fm.contentsOfDirectory(atPath: dl)) ?? [])
        var pool = Set(after.subtracting(before).filter { name in
            let n = name as NSString
            if name == filename { return true }
            if n.pathExtension.caseInsensitiveCompare(ext) != .orderedSame { return false }
            let s = n.deletingPathExtension
            return s == stem || s.hasPrefix(stem + " (")
        })
        // Prefer brand-new names; also accept a matching file whose mtime advanced after the menu press.
        if pool.isEmpty {
            for name in after {
                let n = name as NSString
                let match = name == filename || (n.pathExtension.caseInsensitiveCompare(ext) == .orderedSame && (n.deletingPathExtension == stem || n.deletingPathExtension.hasPrefix(stem + " (")))
                guard match else { continue }
                let full = (dl as NSString).appendingPathComponent(name)
                guard let attrs = try? fm.attributesOfItem(atPath: full), let m = attrs[.modificationDate] as? Date else { continue }
                if let prior = priorMtimes[name], m <= prior { continue }
                pool.insert(name)
            }
        }
        for name in pool.sorted() {
            let full = (dl as NSString).appendingPathComponent(name)
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: full, isDirectory: &isDir), !isDir.boolValue else { continue }
            guard let attrs = try? fm.attributesOfItem(atPath: full), let size = attrs[.size] as? NSNumber, size.intValue > 0 else { continue }
            spin(0.45)
            guard let attrs2 = try? fm.attributesOfItem(atPath: full), let size2 = attrs2[.size] as? NSNumber, size2.intValue == size.intValue else { continue }
            path = full
            bytes = size2.intValue
            break
        }
        if !path.isEmpty { break }
    }
    if path.isEmpty {
        // No *new* Downloads write — a same-named file may already exist, but filename alone
        // does not prove it belongs to this message. Surface it as an unverified candidate.
        var candidatePath = ""
        var candidateBytes = 0
        let names = (try? fm.contentsOfDirectory(atPath: dl)) ?? []
        let matches = names.filter { name in
            let n = name as NSString
            if name == filename { return true }
            if n.pathExtension.caseInsensitiveCompare(ext) != .orderedSame { return false }
            let s = n.deletingPathExtension
            return s == stem || s.hasPrefix(stem + " (")
        }.sorted()
        for name in matches {
            let full = (dl as NSString).appendingPathComponent(name)
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: full, isDirectory: &isDir), !isDir.boolValue else { continue }
            guard let attrs = try? fm.attributesOfItem(atPath: full), let size = attrs[.size] as? NSNumber, size.intValue > 0 else { continue }
            candidatePath = full
            candidateBytes = size.intValue
            if name == filename { break }
        }
        if !candidatePath.isEmpty {
            emitAttachment(AttachmentOut(
                ok: false,
                status: "candidate",
                reason: "A same-named file is already in Downloads, but that alone doesn’t prove it came from this WhatsApp message. Choose it as a candidate, or I can try Save to Downloads again after you move/rename the existing file.",
                header: header,
                visibleOnly: true,
                path: candidatePath,
                filename: (candidatePath as NSString).lastPathComponent,
                bytes: candidateBytes,
                verified: false,
                diag: "header=\(header) provenance=unverified-candidate bytes=\(candidateBytes)"
            ))
        }
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "WhatsApp didn’t place a completed file in Downloads for “\(filename)”.", header: header, visibleOnly: true, filename: filename))
    }
    emitAttachment(AttachmentOut(
        ok: true,
        status: "saved",
        reason: "Saved “\((path as NSString).lastPathComponent)” to Downloads (new file from this chat).",
        header: header,
        visibleOnly: true,
        path: path,
        filename: (path as NSString).lastPathComponent,
        bytes: bytes,
        verified: true,
        diag: "header=\(header) save=downloads provenance=ax-new-file bytes=\(bytes)"
    ))
}

func runClipboardFile() -> Never {
    let raw = stdinText().trimmingCharacters(in: .whitespacesAndNewlines)
    let path = raw.isEmpty ? (flag("--path") ?? "") : raw
    guard !path.isEmpty, path.count < 1024, !path.contains("\0") else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "That file path isn’t one I can copy."))
    }
    let url = URL(fileURLWithPath: path)
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), !isDir.boolValue else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "That file isn’t on disk anymore."))
    }
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: path), let size = attrs[.size] as? NSNumber, size.intValue > 0 else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "That file is empty or unreadable."))
    }
    let pb = NSPasteboard.general
    pb.clearContents()
    let ok = pb.writeObjects([url as NSURL])
    guard ok else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "I couldn’t put the file on the clipboard."))
    }
    // Confirm a file URL is present (not merely the path string).
    let types = pb.types?.map { $0.rawValue } ?? []
    let hasFile = types.contains("public.file-url") || types.contains("NSFilenamesPboardType") || pb.readObjects(forClasses: [NSURL.self], options: nil) != nil
    emitAttachment(AttachmentOut(
        ok: hasFile,
        status: hasFile ? "copied" : "failed",
        reason: hasFile ? "Copied the file (not just its name) to the clipboard." : "The clipboard didn’t accept a file reference.",
        path: path,
        filename: url.lastPathComponent,
        bytes: size.intValue,
        verified: hasFile,
        diag: "clipboardTypes=\(types.prefix(6).joined(separator: ","))"
    ))
}

func runPasteFile() -> Never {
    armWhatsAppCancel()
    let raw = stdinText()
    guard let data = raw.data(using: .utf8), let decoded = try? JSONDecoder().decode(AttachmentIn.self, from: data) else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "That file isn’t one I can attach."))
    }
    let expect = cleanAx(decoded.expectHeader ?? "")
    let path = cleanAx(decoded.path ?? "")
    guard !expect.isEmpty, !path.isEmpty else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "That file isn’t one I can attach."))
    }
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), !isDir.boolValue else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "That file isn’t on disk anymore."))
    }
    guard AXIsProcessTrusted() else {
        emitAttachment(AttachmentOut(ok: false, status: "permission", reason: "MIKO needs Accessibility permission."))
    }
    guard let app = whatsApp() else { emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "WhatsApp isn’t open.")) }
    if !whatsAppFront(app) { _ = activate(app.processIdentifier); spin(0.35) }
    if whatsAppStop { emitAttachment(AttachmentOut(ok: false, status: "cancelled", reason: "Cancelled.")) }
    guard whatsAppFront(app), let win = sceneWindow(app) else {
        emitAttachment(AttachmentOut(ok: false, status: "lost-focus", reason: "WhatsApp isn’t in front, so I didn’t attach."))
    }
    let header = currentHeader(win)
    if header.isEmpty || !sameTitle(header, expect) {
        emitAttachment(AttachmentOut(ok: false, status: "switched", reason: "The open WhatsApp chat is no longer “\(expect)”.", header: header))
    }
    let composerBefore = composerInfo(win).text
    let url = URL(fileURLWithPath: path)
    let pb = NSPasteboard.general
    let priorCount = pb.changeCount
    pb.clearContents()
    guard pb.writeObjects([url as NSURL]) else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "I couldn’t put the file on the clipboard for paste.", header: header))
    }
    guard focusComposer(app) else {
        emitAttachment(AttachmentOut(ok: false, status: "failed", reason: "I couldn’t focus WhatsApp’s message box.", header: header, composerText: String(composerBefore.prefix(4000))))
    }
    if whatsAppStop { emitAttachment(AttachmentOut(ok: false, status: "cancelled", reason: "Cancelled.", header: header)) }
    // Re-check header immediately before paste.
    if !sameTitle(currentHeader(win), expect) {
        emitAttachment(AttachmentOut(ok: false, status: "switched", reason: "The open WhatsApp chat changed before attach.", header: currentHeader(win)))
    }
    keyStroke(9, flags: .maskCommand) // ⌘V
    spin(0.8)
    var afterHeader = currentHeader(win)
    if afterHeader.isEmpty {
        spin(0.35)
        afterHeader = currentHeader(win)
    }
    // Empty header after paste is usually an AX glitch, not a chat switch — only stop when a different title is readable.
    if !afterHeader.isEmpty, !sameTitle(afterHeader, expect) {
        emitAttachment(AttachmentOut(ok: false, status: "switched", reason: "The open WhatsApp chat changed during attach.", header: afterHeader))
    }
    if afterHeader.isEmpty { afterHeader = expect }
    let composer = composerInfo(win)
    let name = url.lastPathComponent.lowercased()
    // Look for an attachment preview/chip mentioning the filename; never Send.
    var preview = false
    func walk(_ e: AXUIElement, _ depth: Int) {
        if depth > 10 || preview { return }
        let blob = (axText(e, "AXDescription") + " " + axText(e, "AXTitle") + " " + axText(e, "AXValue")).lowercased()
        if blob.contains(name) || blob.contains("attachment") || blob.contains("document") {
            let role = axText(e, "AXRole")
            if role != "AXStaticText" || blob.contains(name) { preview = true }
        }
        if let kids = attr(e, "AXChildren") as? [AXUIElement] {
            for kid in kids { walk(kid, depth + 1) }
        }
    }
    walk(win, 0)
    // Composer text for captions should remain; file paste often leaves value unchanged while adding a media chip.
    let textPreserved = composer.text == composerBefore || composerBefore.isEmpty || composer.text.hasPrefix(composerBefore) || composerBefore.hasPrefix(composer.text)
    emitAttachment(AttachmentOut(
        ok: preview,
        status: preview ? "attached" : "failed",
        reason: preview
            ? "Attached “\(url.lastPathComponent)” in “\(expect)” (unsent). Composer text was \(textPreserved ? "preserved" : "changed — check WhatsApp")."
            : "I pasted the file but couldn’t verify an attachment preview. Nothing was sent.",
        header: afterHeader,
        path: path,
        filename: url.lastPathComponent,
        verified: preview,
        composerText: String(composer.text.prefix(4000)),
        composerReady: composer.ready,
        diag: "paste-file preview=\(preview) textPreserved=\(textPreserved) pb=\(pb.changeCount != priorCount)"
    ))
}

func runWhatsAppPeek(withMessages: Bool) -> Never {
    armWhatsAppCancel()
    guard AXIsProcessTrusted() else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "permission", reason: "MIKO needs Accessibility permission (System Settings → Privacy & Security → Accessibility)."))
    }
    guard let app = whatsApp() else { emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "WhatsApp isn’t open.")) }
    if !whatsAppFront(app) {
        _ = activate(app.processIdentifier)
        spin(0.35)
    }
    if whatsAppStop { emitWhatsApp(WhatsAppOut(ok: false, status: "cancelled", reason: "WhatsApp capture cancelled.")) }
    guard whatsAppFront(app), let win = sceneWindow(app) else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", reason: "WhatsApp isn’t in front, so I couldn’t read the open chat."))
    }
    let header = currentHeader(win)
    let composer = composerInfo(win)
    let table = findAxId(win, "ChatMessagesTableView")
    let tableDesc = table.map { cleanAx(axText($0, "AXDescription")) } ?? ""
    let composerRole = findAxId(win, "ChatBar_ComposerTextView").map { axText($0, "AXRole") } ?? ""
    let diag = "header=\(header) table=\(tableDesc.isEmpty ? "missing" : "ChatMessagesTableView") composer=\(composer.ready ? "ChatBar_ComposerTextView/\(composerRole)" : "missing") composerLen=\(composer.text.count)"
    if header.isEmpty {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "I couldn’t read the open WhatsApp chat header.", inspected: true, composerReady: composer.ready, composerText: String(composer.text.prefix(4000)), diag: diag))
    }
    // Conversation table description is “Messages in chat with …”; refuse sidebar-only views.
    if withMessages, table == nil || (!tableDesc.isEmpty && !tableDesc.localizedCaseInsensitiveContains("Messages in chat")) {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "I couldn’t find the open conversation’s message list.", header: header, inspected: true, composerReady: composer.ready, composerText: String(composer.text.prefix(4000)), diag: diag))
    }
    let found = withMessages ? visibleMessages(win, header) : (messages: [], atLatest: true)
    emitWhatsApp(WhatsAppOut(
        ok: true,
        status: "peeked",
        header: header,
        messages: found.messages,
        inspected: true,
        composerReady: composer.ready,
        composerText: String(composer.text.prefix(4000)),
        diag: diag + " msgs=\(found.messages.count) atLatest=\(found.atLatest)",
        atLatest: found.atLatest
    ))
}

func runWhatsAppLatest() -> Never {
    armWhatsAppCancel()
    guard AXIsProcessTrusted() else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "permission", reason: "MIKO needs Accessibility permission (System Settings → Privacy & Security → Accessibility)."))
    }
    guard let app = whatsApp() else { emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "WhatsApp isn’t open.")) }
    if !whatsAppFront(app) {
        _ = activate(app.processIdentifier)
        spin(0.35)
    }
    guard whatsAppFront(app), let win = sceneWindow(app) else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", reason: "WhatsApp isn’t in front, so I couldn’t scroll."))
    }
    let header = currentHeader(win)
    guard !header.isEmpty else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "I couldn’t read the open WhatsApp chat header.", inspected: true))
    }
    let ok = scrollChatToLatest(app, win)
    let found = visibleMessages(win, header)
    emitWhatsApp(WhatsAppOut(
        ok: ok,
        status: ok ? "peeked" : "failed",
        reason: ok ? "" : "I couldn’t scroll to the latest messages.",
        header: header,
        messages: found.messages,
        inspected: true,
        composerReady: composerInfo(win).ready,
        composerText: String(composerInfo(win).text.prefix(4000)),
        diag: "header=\(header) action=scroll-latest atLatest=\(found.atLatest) msgs=\(found.messages.count)",
        atLatest: found.atLatest
    ))
}

func runWhatsAppInsert() -> Never {
    armWhatsAppCancel()
    let raw = stdinText()
    guard let data = raw.data(using: .utf8), let decoded = try? JSONDecoder().decode(WhatsAppIn.self, from: data) else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "That draft isn’t one I can insert."))
    }
    let expect = cleanAx(decoded.expectHeader ?? "")
    let text = decoded.text ?? ""
    let mode = (decoded.mode ?? "replace").lowercased()
    guard !expect.isEmpty else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "That draft isn’t one I can insert."))
    }
    guard mode == "ask" || (!text.isEmpty && text.count <= 4000) else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "That draft isn’t one I can insert."))
    }
    guard AXIsProcessTrusted() else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "permission", reason: "MIKO needs Accessibility permission (System Settings → Privacy & Security → Accessibility)."))
    }
    guard let app = whatsApp() else { emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "WhatsApp isn’t open.")) }
    if !whatsAppFront(app) {
        _ = activate(app.processIdentifier)
        spin(0.35)
    }
    if whatsAppStop { emitWhatsApp(WhatsAppOut(ok: false, status: "cancelled", reason: "WhatsApp insert cancelled.")) }
    guard whatsAppFront(app), let win = sceneWindow(app) else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", reason: "WhatsApp isn’t in front, so I didn’t insert."))
    }
    let header = currentHeader(win)
    if header.isEmpty || !sameTitle(header, expect) {
        emitWhatsApp(WhatsAppOut(ok: true, status: "switched", reason: "The open WhatsApp chat is no longer “\(expect)”.", header: header, inspected: true, composerText: String(composerInfo(win).text.prefix(4000))))
    }
    guard let table = findAxId(win, "ChatMessagesTableView"), let composer = findAxId(win, "ChatBar_ComposerTextView") else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "I couldn’t find WhatsApp’s message box in the open conversation.", header: header, inspected: true, diag: "header=\(header) composer=missing"))
    }
    let tableDesc = cleanAx(axText(table, "AXDescription"))
    let role = axText(composer, "AXRole")
    let diagBase = "header=\(header) table=\(tableDesc) composer=ChatBar_ComposerTextView/\(role)"
    guard role == "AXTextArea" || role == "AXTextField" else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "WhatsApp’s message box isn’t an editable text field.", header: header, inspected: true, diag: diagBase))
    }
    let before = axText(composer, "AXValue")
    if mode == "ask" {
        emitWhatsApp(WhatsAppOut(ok: true, status: before.isEmpty ? "empty" : "has-text", header: header, inspected: true, composerReady: true, composerText: String(before.prefix(4000)), diag: diagBase + " composerLen=\(before.count)"))
    }
    let next: String
    if mode == "append" {
        next = before.isEmpty ? text : (before.hasSuffix("\n") || before.hasSuffix(" ") ? before + text : before + "\n" + text)
    } else {
        next = text
    }
    _ = AXUIElementPerformAction(composer, "AXPress" as CFString)
    AXUIElementSetAttributeValue(composer, "AXFocused" as CFString, kCFBooleanTrue)
    spin(0.2)
    if whatsAppStop { emitWhatsApp(WhatsAppOut(ok: false, status: "cancelled", reason: "WhatsApp insert cancelled.", header: header, diag: diagBase)) }
    // Semantic targeting only: require the focused element to be this conversation’s composer.
    if let focused = focusedElement(app) {
        let fid = axText(focused, "AXIdentifier")
        if fid != "ChatBar_ComposerTextView" {
            emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "Focus wasn’t in WhatsApp’s message box, so I didn’t insert.", header: header, inspected: true, diag: diagBase + " focused=\(fid)"))
        }
    }
    guard whatsAppFront(app), sameTitle(currentHeader(win), expect) else {
        emitWhatsApp(WhatsAppOut(ok: true, status: "switched", reason: "The open WhatsApp chat changed before I could insert.", header: currentHeader(win), inspected: true, diag: diagBase))
    }
    // Draft insert only — set AXValue. Never Return/Enter, never click Send, never dismiss a dialog while the composer is focused.
    let set = AXUIElementSetAttributeValue(composer, "AXValue" as CFString, next as CFString) == .success
    spin(0.15)
    let after = axText(composer, "AXValue")
    let verified = set && after == next
    if !verified {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "I couldn’t put the draft into WhatsApp’s message box.", header: header, inspected: true, composerReady: true, composerText: String(after.prefix(4000)), verified: false, diag: diagBase + " verified=false"))
    }
    emitWhatsApp(WhatsAppOut(ok: true, status: "inserted", header: header, inspected: true, composerReady: true, composerText: String(after.prefix(4000)), verified: true, diag: diagBase + " verified=true composerLen=\(after.count)"))
}

func runWhatsApp() -> Never {
    armWhatsAppCancel()
    let raw = stdinText()
    let pressName: String
    let pressSnippet: String
    let query: String
    var reuseSearch = false
    if let data = raw.data(using: .utf8), let decoded = try? JSONDecoder().decode(WhatsAppIn.self, from: data), let search = decoded.search, !search.isEmpty {
        query = cleanAx(search)
        pressName = cleanAx(decoded.name ?? "")
        pressSnippet = String(cleanAx(decoded.snippet ?? "").prefix(120))
        reuseSearch = decoded.reuseSearch == true
    } else {
        query = cleanAx(raw)
        pressName = args.contains("--press") ? query : ""
        pressSnippet = ""
    }
    let press = !pressName.isEmpty
    guard !query.isEmpty, query.count <= 80 else { emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "That name isn’t one I can search for.")) }
    guard AXIsProcessTrusted() else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "permission", reason: "MIKO needs Accessibility permission (System Settings → Privacy & Security → Accessibility)."))
    }
    guard let app = whatsApp() else { emitWhatsApp(WhatsAppOut(ok: false, status: "failed", reason: "WhatsApp isn’t open.")) }
    if !activate(app.processIdentifier) {
        emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", query: query, reason: "WhatsApp isn’t in front, so I stopped."))
    }
    for _ in 0..<10 {
        if whatsAppStop { emitWhatsApp(WhatsAppOut(ok: false, status: "cancelled", query: query, reason: "WhatsApp search cancelled.")) }
        spin(0.05)
        if whatsAppFront(app) { break }
    }
    guard whatsAppFront(app), let window = sceneWindow(app) else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", query: query, reason: "WhatsApp isn’t in front, so I stopped."))
    }
    var value = searchValue(app)
    let canReuse = reuseSearch && value.range(of: query, options: .caseInsensitive) != nil
    if !canReuse {
        guard focusSearch(app, window) != nil else {
            if let el = focusedElement(app), axText(el, "AXIdentifier") == "ChatBar_ComposerTextView" {
                emitWhatsApp(WhatsAppOut(ok: false, status: "failed", query: query, reason: "The message box was focused, so I didn’t type and left the draft alone."))
            }
            emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", query: query, reason: "WhatsApp isn’t in front, so I stopped."))
        }
        if !searchValue(app).isEmpty {
            clearSearch(app)
            if !searchValue(app).isEmpty {
                emitWhatsApp(WhatsAppOut(ok: false, status: "failed", query: query, reason: "WhatsApp’s search wasn’t empty, so I didn’t type over it."))
            }
        }
        guard whatsAppFront(app), focusSearch(app, window) != nil else {
            emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", query: query, reason: "WhatsApp isn’t in front, so I stopped."))
        }
        guard typeIntoSearch(query, app) else {
            if whatsAppStop { emitWhatsApp(WhatsAppOut(ok: false, status: "cancelled", query: query, reason: "WhatsApp search cancelled.")) }
            if let el = focusedElement(app), axText(el, "AXIdentifier") == "ChatBar_ComposerTextView" {
                emitWhatsApp(WhatsAppOut(ok: false, status: "failed", query: query, reason: "The message box was focused, so I didn’t type and left the draft alone."))
            }
            emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", query: query, reason: "WhatsApp isn’t in front any more, so I stopped."))
        }
        value = ""
        for _ in 0..<20 {
            if whatsAppStop { emitWhatsApp(WhatsAppOut(ok: false, status: "cancelled", query: query, reason: "WhatsApp search cancelled.")) }
            if !whatsAppFront(app) { emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", query: query, reason: "WhatsApp isn’t in front any more, so I stopped.")) }
            spin(0.1)
            value = searchValue(app)
            if value.range(of: query, options: .caseInsensitive) != nil { break }
        }
        guard value.range(of: query, options: .caseInsensitive) != nil else {
            emitWhatsApp(WhatsAppOut(ok: false, status: "failed", query: query, reason: "I couldn’t put that name into WhatsApp’s search.", searchValue: value))
        }
        // Typing fills the field. The Search menu is what makes WhatsApp show the filtered rows.
        _ = pressSearchMenu(app)
        spin(0.25)
    }
    guard searchValue(app).range(of: query, options: .caseInsensitive) != nil, let listed = sceneWindow(app) else {
        emitWhatsApp(WhatsAppOut(ok: false, status: "failed", query: query, reason: canReuse ? "WhatsApp’s search results went stale, so I stopped before pressing again." : "WhatsApp’s search didn’t keep that name.", searchValue: searchValue(app)))
    }
    var found = searchRows(listed)
    if !found.ready {
        for _ in 0..<30 {
            if whatsAppStop { emitWhatsApp(WhatsAppOut(ok: false, status: "cancelled", query: query, reason: "WhatsApp search cancelled.")) }
            if !whatsAppFront(app) { emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", query: query, reason: "WhatsApp isn’t in front any more, so I stopped.")) }
            spin(0.1)
            if let again = sceneWindow(app) { found = searchRows(again) }
            if found.ready { break }
        }
    }
    if !found.ready {
        emitWhatsApp(WhatsAppOut(ok: true, status: "assisted", query: query, reason: "I put the name in WhatsApp’s search. I couldn’t read the results, so pick the chat there.", searchValue: value))
    }
    if press {
        var pressHits = 0
        if sceneWindow(app) != nil {
            for row in found.rows where sameTitle(row.name, pressName) {
                if pressSnippet.isEmpty || sameTitle(row.snippet, pressSnippet) || cleanAx(row.snippet).localizedCaseInsensitiveContains(cleanAx(pressSnippet)) || cleanAx(pressSnippet).localizedCaseInsensitiveContains(cleanAx(row.snippet)) {
                    pressHits += 1
                }
            }
        }
        if pressHits > 1 {
            emitWhatsApp(WhatsAppOut(ok: true, status: "assisted", query: query, reason: "Several chats look the same in WhatsApp. Pick the one you want there.", rows: found.rows, inspected: true, searchValue: value))
        }
        guard let current = sceneWindow(app), pressRow(current, pressName, pressSnippet) else {
            emitWhatsApp(WhatsAppOut(ok: true, status: "none", query: query, reason: "That chat isn’t in the WhatsApp results.", rows: found.rows, inspected: true, searchValue: value))
        }
        var header = ""
        for _ in 0..<15 {
            if whatsAppStop { emitWhatsApp(WhatsAppOut(ok: false, status: "cancelled", query: query, reason: "WhatsApp search cancelled.")) }
            if !whatsAppFront(app) { emitWhatsApp(WhatsAppOut(ok: false, status: "lost-focus", query: query, reason: "WhatsApp isn’t in front any more, so I stopped.")) }
            spin(0.1)
            if let win = sceneWindow(app) { header = confirmedHeader(win, pressName) }
            if !header.isEmpty { break }
        }
        guard !header.isEmpty else {
            emitWhatsApp(WhatsAppOut(ok: true, status: "unverified", query: query, reason: "I selected a row but couldn’t confirm the chat header.", rows: found.rows, inspected: true, searchValue: value))
        }
        if whatsAppFront(app) { clearSearch(app) }
        let ready = focusComposer(app)
        emitWhatsApp(WhatsAppOut(ok: true, status: "opened", query: query, header: header, rows: found.rows, inspected: true, composerReady: ready, searchValue: value))
    }
    emitWhatsApp(WhatsAppOut(ok: true, status: found.none ? "none" : "results", query: query, rows: found.rows, inspected: true, searchValue: value))
}

// MARK: Commands

let command = args.count > 1 ? args[1] : ""
switch command {
case "focus-info":
    if let p = flag("--activate"), let pid = Int32(p), !activate(pid) { fail("Couldn’t bring that app to the front.") }
    let t = focused()
    var o = t.out
    if let b = flag("--bundle"), o.bundle != b { fail("\(b) isn’t the app in front (\(o.app) is).", o) }
    if t.element == nil { o.ok = false }
    emit(o)

case "capture":
    let t = focused()
    var o = t.out
    if o.secure { fail("That’s a password field. MIKO never reads it.", o) }
    if let el = t.element, let sel = attr(el, "AXSelectedText") as? String, !sel.isEmpty {
        o.text = sel; o.hash = sha(sel); o.method = "ax"; emit(o)
    }
    let (copied, restored) = copySelection(pid: t.app.processIdentifier)
    guard let text = copied, !text.isEmpty else { fail("No selected text found in \(o.app).", o) }
    o.text = text; o.hash = sha(text); o.method = "copy"; o.clipboardRestored = restored
    emit(o)

case "replace":
    guard let p = flag("--pid"), let pid = Int32(p), let sig = flag("--sig"), let hash = flag("--hash") else { fail("Missing target.") }
    let text = stdinText()
    guard activate(pid) else { fail("The original app isn’t available any more.") }
    spin(0.15)
    let t = focused(pid: pid)
    var o = t.out
    guard let el = t.element, o.editable else { fail("The original field isn’t focused or editable any more.", o) }
    guard o.sig == sig else { fail("The focus moved to a different field. Choose the target again.", o) }
    if (flag("--method") ?? "ax") == "ax" {
        guard let sel = attr(el, "AXSelectedText") as? String, sha(sel) == hash else { fail("The selection changed. Select the text again.", o) }
    } else {
        let (current, _) = copySelection(pid: pid)
        guard let cur = current, sha(cur) == hash else { fail("The selection changed. Select the text again.", o) }
    }
    if axInsert(el, text, mode: "selection") { o.method = "ax"; o.verified = true; emit(o) }
    let (_, verified, restored) = pasteInsert(t, text)
    o.method = "paste"; o.verified = verified; o.clipboardRestored = restored
    emit(o)

case "insert":
    guard let p = flag("--pid"), let pid = Int32(p) else { fail("Missing target.") }
    let text = stdinText()
    guard activate(pid) else { fail("Couldn’t bring that app to the front.") }
    spin(0.2)
    let t = focused(pid: pid)
    var o = t.out
    guard o.pid == pid else { fail("A different app came to the front.", o) }
    guard let el = t.element, o.editable else { fail(o.reason.isEmpty ? "No editable field is focused in \(o.app)." : o.reason, o) }
    if let sig = flag("--sig"), o.sig != sig { fail("The focused field changed. Try again.", o) }
    let mode = flag("--mode") ?? "selection"
    if axInsert(el, text, mode: mode) { o.method = "ax"; o.verified = true; emit(o) }
    fail("Couldn’t insert and verify the text in \(o.app). Nothing was typed.", o)

case "paste":
    let text = stdinText()
    // --settle-ms: give an app that was just activated time to focus its own input before pasting.
    if let ms = flag("--settle-ms"), let wait = Double(ms) { spin(min(wait, 2000) / 1000) }
    let t = focused()
    var o = t.out
    if let ex = flag("--exclude-pid"), Int32(ex) == o.pid { fail("MIKO is in front. Click into the field you want first.", o) }
    if let want = flag("--expect-pid"), Int32(want) != o.pid { fail("\(o.app) is in front, not the app you chose.", o) }
    if let bundles = flag("--expect-bundles"), !bundles.split(separator: ",").map(String.init).contains(o.bundle) {
        fail("\(o.app) is in front, not the app MIKO armed for.", o)
    }
    if t.element == nil && args.contains("--allow-unexposed") {
        // The app exposes no focused field to Accessibility (e.g. ChatGPT, Chrome pages). The user's own
        // click plus the explicit confirm shortcut is the only identification, so paste once and say it's unchecked.
        let (_, _, restored) = pasteInsert(t, text)
        o.method = "paste-unverified"; o.verified = false; o.clipboardRestored = restored
        emit(o)
    }
    guard t.element != nil, o.editable else { fail(o.secure ? "That’s a password field. MIKO won’t paste there." : "The focused place in \(o.app) isn’t an editable text field.", o) }
    if let el = t.element, axInsert(el, text, mode: "selection") { o.method = "ax"; o.verified = true; emit(o) }
    let (_, verified, restored) = pasteInsert(t, text)
    o.method = "paste"; o.verified = verified; o.clipboardRestored = restored
    emit(o)

case "whatsapp":
    runWhatsApp()

case "whatsapp-peek":
    runWhatsAppPeek(withMessages: args.contains("--messages"))

case "whatsapp-latest":
    runWhatsAppLatest()

case "whatsapp-insert":
    runWhatsAppInsert()

case "whatsapp-attachments":
    runWhatsAppAttachments()

case "whatsapp-attachment-save":
    runWhatsAppAttachmentSave()

case "clipboard-file":
    runClipboardFile()

case "paste-file":
    runPasteFile()

default:
    fail("Unknown command.")
}
