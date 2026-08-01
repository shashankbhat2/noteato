import AgentCore
import AppKit

/// The resident menu-bar process.
///
/// Phase 2 gives it a microphone. The rule the whole feature rests on is that
/// the microphone's own state is the truth: the menu bar icon, its tooltip and
/// its menu are all derived from what `MicCapture` is actually doing, never set
/// alongside it. A user must never have to wonder whether the mic is hot.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static let version = "0.2.0-phase2"

    private var statusItem: NSStatusItem?
    private let hud = CaptureHUD()
    private let hotkeys = HotkeyManager()
    private let server = SocketServer()
    private let launcher = LibraryLauncher()
    private let mic = MicCapture()

    /// The user's own pause, distinct from "the mic happens to be closed".
    /// Screen lock does not set this, so unlocking restores listening — but it
    /// never overrides a pause the user asked for.
    private var pausedByUser = false
    private var settings = AgentSettings.load()
    private var hudTimer: Timer?
    /// Held only while the HUD is up, so Esc keeps its normal meaning in every
    /// other app the rest of the time.
    private var captureKeys: [HotkeyManager.Token] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        setUpStatusItem()
        startServer()

        hotkeys.start()
        let capture = hotkeys.register(.capture) { [weak self] in self?.toggleCapture() }
        let sidebar = hotkeys.register(.sidebar) { [weak self] in self?.toggleSidebar() }
        let library = hotkeys.register(.library) { [weak self] in self?.openLibrary() }
        if capture == nil || sidebar == nil || library == nil {
            // Another app already owns the combination. Not fatal — the menu
            // bar still works — but the user needs to know why their key does
            // nothing, so it is surfaced rather than logged.
            statusItem?.button?.toolTip = "Noteato: a global shortcut is already in use"
        }

        mic.onStateChange = { [weak self] _ in
            DispatchQueue.main.async { self?.refreshStatusItem() }
        }
        mic.setPreRollSeconds(settings.preRollSeconds)
        startListeningIfAllowed()
        observeScreenLock()
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Quitting discards the buffer. Nothing survives this process that the
        // user did not explicitly commit.
        mic.stopListening()
        hotkeys.stop()
        server.stop()
    }

    // MARK: - Listening

    private func startListeningIfAllowed() {
        guard !pausedByUser, settings.preRollSeconds > 0 else {
            refreshStatusItem()
            return
        }
        mic.startListening()
        refreshStatusItem()
    }

    @objc private func togglePause() {
        pausedByUser.toggle()
        if pausedByUser {
            mic.stopListening()
        } else {
            settings = AgentSettings.load()
            mic.setPreRollSeconds(settings.preRollSeconds)
            startListeningIfAllowed()
        }
        refreshStatusItem()
    }

    /// Locking the screen closes the mic; unlocking reopens it. Someone who
    /// walked away from their desk did not leave a microphone running on
    /// purpose — and a pause they set themselves outranks both.
    private func observeScreenLock() {
        let center = DistributedNotificationCenter.default()
        center.addObserver(
            forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, !self.pausedByUser else { return }
                self.mic.stopListening()
                self.refreshStatusItem()
            }
        }
        center.addObserver(
            forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, !self.pausedByUser else { return }
                self.startListeningIfAllowed()
            }
        }
    }

    // MARK: - Capture

    private func toggleCapture() {
        if hud.isVisible { finishCapture(keep: true) } else { beginCapture() }
    }

    private func beginCapture() {
        // Paused, or pre-roll disabled: capture still works, it just starts now
        // instead of in the past. Refusing outright would be worse.
        if mic.state == .idle && !pausedByUser && settings.preRollSeconds > 0 {
            mic.startListening()
        }
        mic.beginCapture()
        hud.show()
        server.send(AgentMessage(type: .hudDidShow))
        refreshStatusItem()

        captureKeys = [
            hotkeys.register(.commitCapture) { [weak self] in self?.finishCapture(keep: true) },
            hotkeys.register(.discardCapture) { [weak self] in self?.finishCapture(keep: false) }
        ].compactMap { $0 }

        hudTimer?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.hud.setLevel(CGFloat(self.mic.currentLevel))
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        hudTimer = timer
    }

    private func finishCapture(keep: Bool) {
        guard hud.isVisible else { return }
        hudTimer?.invalidate()
        hudTimer = nil
        for token in captureKeys { hotkeys.unregister(token) }
        captureKeys = []

        hud.hide()
        server.send(AgentMessage(type: .hudDidHide))

        let samples = mic.endCapture(keep: keep)
        refreshStatusItem()
        guard keep, !samples.isEmpty else { return }

        let rate = mic.sampleRate
        let vault = settings.notesDirectory
        // Encoding is not instant and must not block the run loop the HUD and
        // the hotkeys live on.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let committed = try CaptureWriter.commit(
                    samples: samples, sampleRate: rate, vault: vault)
                DispatchQueue.main.async {
                    self?.server.send(
                        AgentMessage(type: .captureCommitted, path: committed.directory.path))
                }
            } catch {
                DispatchQueue.main.async { self?.reportCaptureFailure(error) }
            }
        }
    }

    /// A capture that could not be written is the one failure the user has to
    /// hear about immediately: they believe they just saved a thought.
    private func reportCaptureFailure(_ error: Error) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "That capture could not be saved"
        alert.informativeText =
            "\(error.localizedDescription)\n\nCheck that the notes folder in Settings still exists."
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    // MARK: - Menu bar

    private func setUpStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        statusItem = item
        refreshStatusItem()
    }

    /// Derived from the microphone's real state, never set alongside it.
    private func refreshStatusItem() {
        guard let button = statusItem?.button else { return }
        let symbol: String
        let description: String
        switch mic.state {
        case .recording:
            symbol = "record.circle"
            description = "Noteato — recording"
        case .listening:
            symbol = "waveform"
            description = "Noteato — listening · last \(Int(settings.preRollSeconds))s buffered"
        case .idle:
            symbol = "waveform.slash"
            description = pausedByUser ? "Noteato — listening paused" : "Noteato — microphone off"
        }
        let icon = NSImage(systemSymbolName: symbol, accessibilityDescription: description)
        icon?.isTemplate = true
        button.image = icon
        button.toolTip = description
    }

    private func rebuildMenu(_ menu: NSMenu) {
        menu.removeAllItems()

        // Say what the microphone is doing, at the top, every time the menu
        // opens. This is the honest indicator §3 asks for.
        let status = NSMenuItem(
            title: statusItem?.button?.toolTip ?? "Noteato", action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())

        add(menu, "Capture   ⌥⌘Space", #selector(menuCapture))
        let pause = add(
            menu, pausedByUser ? "Resume listening" : "Pause listening", #selector(togglePause))
        pause.state = pausedByUser ? .on : .off
        menu.addItem(.separator())

        add(menu, "Open Library   ⇧⌥⌘S", #selector(menuOpenLibrary))
        let connection = NSMenuItem(
            title: server.hasClient ? "Library connected" : "Library not running", action: nil,
            keyEquivalent: "")
        connection.isEnabled = false
        menu.addItem(connection)
        menu.addItem(.separator())
        add(menu, "Quit Noteato Agent", #selector(menuQuit))
    }

    @discardableResult
    private func add(_ menu: NSMenu, _ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        menu.addItem(item)
        return item
    }

    @objc private func menuCapture() { toggleCapture() }
    @objc private func menuOpenLibrary() { openLibrary() }
    @objc private func menuQuit() { NSApp.terminate(nil) }

    // MARK: - Library

    private func toggleSidebar() {
        if server.hasClient {
            server.send(AgentMessage(type: .toggleSidebar))
        } else {
            launcher.launch()
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
        case .settingsChanged:
            // Settings live in one file that Electron owns; re-read rather than
            // trusting a payload, so the agent and the UI cannot disagree about
            // something as consequential as whether the mic is open.
            settings = AgentSettings.load()
            mic.setPreRollSeconds(settings.preRollSeconds)
            if !pausedByUser { startListeningIfAllowed() }
            refreshStatusItem()
        case .goodbye:
            break
        }
    }
}

extension AppDelegate: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        rebuildMenu(menu)
    }
}
