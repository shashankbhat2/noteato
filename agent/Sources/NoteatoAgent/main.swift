import AppKit

// LSUIElement equivalent, set in code so the agent works both as a bare binary
// (development, benchmarks) and embedded in the app bundle: menu bar only, no
// Dock icon, never activates.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let delegate = AppDelegate()
app.delegate = delegate
app.run()
