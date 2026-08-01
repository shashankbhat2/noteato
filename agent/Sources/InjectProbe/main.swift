// Diagnostic for §7's compatibility matrix.
//
//   swift run -c release InjectProbe "text to type"
//
// Injects into whatever is frontmost and reports which route worked. The
// compatibility question — Slack, Mail, browsers, terminals, Electron apps —
// cannot be answered by unit tests, only by trying it, and "which route" is the
// answer that matters: Accessibility is precise and leaves the clipboard alone,
// the pasteboard fallback is a real intrusion that has to restore what it
// borrowed.
import AppKit
import AgentCore
import Foundation

let text = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Noteato injection test"

MainActor.assumeIsolated {
    var report: [String: Any] = [:]
    report["accessibilityTrusted"] = TextInjector.hasAccessibilityPermission

    let frontmost = NSWorkspace.shared.frontmostApplication
    report["frontmostApp"] = frontmost?.localizedName ?? "unknown"
    report["frontmostBundleId"] = frontmost?.bundleIdentifier ?? "unknown"

    // What the clipboard held before, so the restore can be checked.
    let before = NSPasteboard.general.string(forType: .string)
    report["clipboardBefore"] = before ?? "(empty)"

    let route = TextInjector.insert(text)
    report["route"] = route.rawValue

    // The pasteboard route restores asynchronously; wait past that window.
    let deadline = Date().addingTimeInterval(1.0)
    while Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }

    let after = NSPasteboard.general.string(forType: .string)
    report["clipboardAfter"] = after ?? "(empty)"
    report["clipboardRestored"] = (before == after)

    let data = try! JSONSerialization.data(
        withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    print("INJECT_PROBE " + String(data: data, encoding: .utf8)!)
    exit(0)
}
