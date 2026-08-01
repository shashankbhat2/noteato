import AppKit
import ApplicationServices

/// Puts dictated text into whatever the user is typing in, in any app.
///
/// Two routes, tried in order, because no single one works everywhere:
///
/// 1. **Accessibility** — read the focused element's value and set it with the
///    new text spliced in at the insertion point. Precise, leaves the clipboard
///    alone, and is what native Cocoa text fields support.
/// 2. **Pasteboard + ⌘V** — for everything that refuses the first: Electron
///    apps, terminals, web views that expose no settable AX value. This is a
///    real intrusion (it borrows the clipboard), so the previous contents are
///    restored afterwards, and the restore is the part that has to be right.
///
/// §7 asks for verbatim-leaning output. Nothing here rewrites what was said —
/// the only text this module adds is a separating space, and only when the
/// surrounding text needs one.
@MainActor
public enum TextInjector {
    public enum Route: String, Sendable {
        case accessibility
        case pasteboard
        case failed
    }

    /// Whether this process may drive other apps. False until the user grants
    /// Accessibility in System Settings — which they must do by hand, so the
    /// caller has to be able to say so rather than silently doing nothing.
    public static var hasAccessibilityPermission: Bool {
        AXIsProcessTrusted()
    }

    /// Ask for Accessibility, showing the system prompt with a link to
    /// Settings. Returns the state at the time of the call; granting happens
    /// out of process, so a false here is not final.
    @discardableResult
    public static func requestAccessibilityPermission() -> Bool {
        // The constant is a global var in the C header, which Swift 6 treats
        // as shared mutable state. Its value is stable API.
        let options = ["AXTrustedCheckOptionPrompt": true]
        return AXIsProcessTrustedWithOptions(options as CFDictionary)
    }

    /// Insert `text` at the caret in the frontmost app.
    @discardableResult
    public static func insert(_ text: String) -> Route {
        guard !text.isEmpty else { return .failed }
        if insertViaAccessibility(text) { return .accessibility }
        if insertViaPasteboard(text) { return .pasteboard }
        return .failed
    }

    // MARK: - Accessibility

    private static func insertViaAccessibility(_ text: String) -> Bool {
        guard AXIsProcessTrusted() else { return false }

        let system = AXUIElementCreateSystemWide()
        var focused: CFTypeRef?
        guard
            AXUIElementCopyAttributeValue(
                system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
            let element = focused
        else { return false }
        let target = element as! AXUIElement

        // Prefer setting the selected text: it respects the caret and any
        // selection, and works without knowing the full field contents.
        let selected = AXUIElementSetAttributeValue(
            target, kAXSelectedTextAttribute as CFString, text as CFTypeRef)
        if selected == .success { return true }

        // Otherwise splice into the whole value at the insertion point.
        var valueRef: CFTypeRef?
        guard
            AXUIElementCopyAttributeValue(target, kAXValueAttribute as CFString, &valueRef)
                == .success,
            let current = valueRef as? String
        else { return false }

        var rangeRef: CFTypeRef?
        var insertAt = current.count
        if AXUIElementCopyAttributeValue(
            target, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success,
            let rangeValue = rangeRef
        {
            var range = CFRange()
            if AXValueGetValue(rangeValue as! AXValue, .cfRange, &range) {
                insertAt = min(max(range.location, 0), current.count)
            }
        }

        let index = current.index(current.startIndex, offsetBy: insertAt)
        let updated = current[..<index] + text + current[index...]
        let wrote = AXUIElementSetAttributeValue(
            target, kAXValueAttribute as CFString, String(updated) as CFTypeRef)
        guard wrote == .success else { return false }

        // Put the caret after what was just inserted; without this it snaps to
        // the start and the next phrase lands in front of this one.
        var caret = CFRange(location: insertAt + text.count, length: 0)
        if let position = AXValueCreate(.cfRange, &caret) {
            AXUIElementSetAttributeValue(
                target, kAXSelectedTextRangeAttribute as CFString, position)
        }
        return true
    }

    // MARK: - Pasteboard fallback

    private static func insertViaPasteboard(_ text: String) -> Bool {
        guard AXIsProcessTrusted() else { return false }
        let pasteboard = NSPasteboard.general

        // Snapshot every representation, not just the string: someone who had
        // an image or rich text on the clipboard should get it back intact.
        let saved = pasteboard.pasteboardItems?.compactMap { item -> [NSPasteboard.PasteboardType: Data] in
            var copy: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) { copy[type] = data }
            }
            return copy
        }

        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        sendPaste()

        // The paste is asynchronous in the target app, so the clipboard cannot
        // be restored immediately without racing it. This delay is a
        // compromise, and an honest one: too short and the app pastes the
        // restored contents, too long and the user's clipboard is wrong for
        // longer than it should be.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            pasteboard.clearContents()
            guard let saved, !saved.isEmpty else { return }
            let items: [NSPasteboardItem] = saved.map { entry in
                let item = NSPasteboardItem()
                for (type, data) in entry { item.setData(data, forType: type) }
                return item
            }
            pasteboard.writeObjects(items)
        }
        return true
    }

    private static func sendPaste() {
        guard let source = CGEventSource(stateID: .combinedSessionState) else { return }
        let v: CGKeyCode = 9  // kVK_ANSI_V
        guard
            let down = CGEvent(keyboardEventSource: source, virtualKey: v, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: v, keyDown: false)
        else { return }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cgAnnotatedSessionEventTap)
        up.post(tap: .cgAnnotatedSessionEventTap)
    }
}

/// Decides what separator a phrase needs given what is already in front of it.
///
/// Pure and separately testable, because getting it wrong is the difference
/// between "hello there" and "hellothere" — and it is the only text this
/// feature adds to what the user actually said.
public enum DictationSpacing {
    public static func prepare(_ phrase: String, precededBy previous: String?) -> String {
        let trimmed = phrase.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        guard let previous, let last = previous.last else { return trimmed }

        // A space already there, or an opening bracket, needs nothing added.
        if last.isWhitespace || "([{\"'".contains(last) { return trimmed }
        // Neither does punctuation the new phrase starts with.
        if let first = trimmed.first, ".,!?;:)".contains(first) { return trimmed }
        return " " + trimmed
    }
}
