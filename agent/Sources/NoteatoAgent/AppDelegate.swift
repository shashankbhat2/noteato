import AgentCore
import AppKit

/// The resident menu-bar process.
///
/// Phase 1 proves the process model and the hotkey→HUD latency; there is no
/// audio yet. What it does establish is the invariant the rest of the revamp
/// leans on: this process owns the hotkeys and the HUD, it stays up, and the
/// Electron library is an optional client that can come and go.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static let version = "0.1.0-phase1"

    private var statusItem: NSStatusItem?
    private let hud = CaptureHUD()
    private let hotkeys = HotkeyManager()
    private let server = SocketServer()
    private let launcher = LibraryLauncher()

    func applicationDidFinishLaunching(_ notification: Notification) {
        setUpStatusItem()
        startServer()

        hotkeys.start()
        let captureOK = hotkeys.register(.capture) { [weak self] in self?.toggleHUD() }
        let sidebarOK = hotkeys.register(.sidebar) { [weak self] in self?.openLibrary() }
        if !captureOK || !sidebarOK {
            // Another app already owns the combination. Not fatal — the menu
            // bar item still works — but the user needs to know why their key
            // does nothing, so it is surfaced rather than logged.
            statusItem?.button?.toolTip = "Noteato: a global shortcut is already in use"
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        hotkeys.stop()
        server.stop()
    }

    // MARK: - Menu bar

    private func setUpStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        // A template image so macOS recolours it for light and dark menu bars.
        let icon = NSImage(
            systemSymbolName: "waveform", accessibilityDescription: "Noteato")
        icon?.isTemplate = true
        item.button?.image = icon

        let menu = NSMenu()
        menu.addItem(
            withTitle: "Capture   ⌥⌘Space", action: #selector(menuCapture), keyEquivalent: "")
            .target = self
        menu.addItem(
            withTitle: "Open Library", action: #selector(menuOpenLibrary), keyEquivalent: "")
            .target = self
        menu.addItem(.separator())
        let status = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        status.isEnabled = false
        status.tag = 99
        menu.addItem(status)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Noteato Agent", action: #selector(menuQuit), keyEquivalent: "")
            .target = self
        menu.delegate = self
        item.menu = menu
        statusItem = item
    }

    @objc private func menuCapture() { toggleHUD() }
    @objc private func menuOpenLibrary() { openLibrary() }
    @objc private func menuQuit() { NSApp.terminate(nil) }

    // MARK: - Actions

    private func toggleHUD() {
        if hud.isVisible {
            hud.hide()
            server.send(AgentMessage(type: .hudDidHide))
        } else {
            hud.show()
            server.send(AgentMessage(type: .hudDidShow))
        }
    }

    /// If the library is connected it is already running: ask it to surface
    /// itself. Otherwise launch it. Either way the agent never waits on it.
    private func openLibrary() {
        if server.hasClient {
            server.send(AgentMessage(type: .showLibrary))
        } else {
            launcher.launch()
        }
    }

    private func startServer() {
        server.onMessage = { [weak self] message in
            // Socket callbacks arrive on the server's queue, not the main one.
            DispatchQueue.main.async { self?.handle(message) }
        }
        do {
            try server.start()
        } catch {
            FileHandle.standardError.write(
                Data("NoteatoAgent: socket unavailable (\(error))\n".utf8))
        }
    }

    private func handle(_ message: ClientMessage) {
        switch message.type {
        case .hello:
            server.send(
                AgentMessage(
                    type: .welcome, version: AppDelegate.version,
                    pid: Int(ProcessInfo.processInfo.processIdentifier),
                    protocolVersion: Wire.protocolVersion))
        case .ping:
            server.send(AgentMessage(type: .pong))
        case .goodbye:
            break
        }
    }
}

extension AppDelegate: NSMenuDelegate {
    /// Whether the library is attached is the one piece of agent state a user
    /// can act on, so the menu says it rather than leaving it to be inferred.
    func menuWillOpen(_ menu: NSMenu) {
        menu.item(withTag: 99)?.title =
            server.hasClient ? "Library connected" : "Library not running"
    }
}
