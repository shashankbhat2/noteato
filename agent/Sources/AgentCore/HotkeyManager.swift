import AppKit
import Carbon.HIToolbox

/// Global hotkeys via `RegisterEventHotKey`.
///
/// Deliberately Carbon rather than `CGEvent.tapCreate`: an event tap would
/// require Accessibility permission, and Phase 1 has not earned that yet.
/// Asking for "control your computer" before the app can capture anything is
/// how a permission prompt gets denied and never revisited.
///
/// The agent is the single registrar for every global shortcut in the product —
/// Electron's `globalShortcut` is gone. Two processes racing to register the
/// same accelerator is a bug that only shows up on someone else's machine.
@MainActor
public final class HotkeyManager {
    public struct Shortcut: Equatable, Sendable {
        public let keyCode: UInt32
        public let modifiers: UInt32
        public init(keyCode: UInt32, modifiers: UInt32) {
            self.keyCode = keyCode
            self.modifiers = modifiers
        }

        /// ⌥⌘Space — capture.
        public static let capture = Shortcut(
            keyCode: UInt32(kVK_Space), modifiers: UInt32(optionKey | cmdKey))
        /// ⌥⌘S — the compact side panel. The library owns the panel itself, so
        /// the agent forwards this rather than handling it; the accelerator
        /// matches SIDEBAR_MODE_ACCELERATOR in src/shared/globalShortcuts.ts.
        /// Taking ownership of a shortcut without preserving what it did is a
        /// silent regression, which is exactly what this pairing prevents.
        public static let sidebar = Shortcut(
            keyCode: UInt32(kVK_ANSI_S), modifiers: UInt32(optionKey | cmdKey))
        /// ⇧⌥⌘S — bring the library to the front (launching it if needed).
        public static let library = Shortcut(
            keyCode: UInt32(kVK_ANSI_S), modifiers: UInt32(optionKey | cmdKey | shiftKey))
    }

    private var handlers: [UInt32: () -> Void] = [:]
    private var registered: [UInt32: EventHotKeyRef] = [:]
    private var nextID: UInt32 = 1
    private var eventHandler: EventHandlerRef?

    public init() {}

    public func start() {
        var spec = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let context = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(
            GetEventDispatcherTarget(),
            { _, event, userData in
                guard let event, let userData else { return noErr }
                var hotKeyID = EventHotKeyID()
                GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                    nil, MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
                let manager = Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue()
                // The Carbon callback arrives on the main thread; this states it.
                MainActor.assumeIsolated { manager.fire(id: hotKeyID.id) }
                return noErr
            },
            1, &spec, context, &eventHandler)
    }

    private func fire(id: UInt32) {
        handlers[id]?()
    }

    @discardableResult
    public func register(_ shortcut: Shortcut, action: @escaping () -> Void) -> Bool {
        let id = nextID
        nextID += 1
        var ref: EventHotKeyRef?
        let hotKeyID = EventHotKeyID(signature: OSType(0x4E54_4F41 /* NTOA */ ), id: id)
        let status = RegisterEventHotKey(
            shortcut.keyCode, shortcut.modifiers, hotKeyID, GetEventDispatcherTarget(), 0, &ref)
        guard status == noErr, let ref else { return false }
        registered[id] = ref
        handlers[id] = action
        return true
    }

    public func unregisterAll() {
        for (_, ref) in registered { UnregisterEventHotKey(ref) }
        registered.removeAll()
        handlers.removeAll()
    }

    /// Explicit rather than a `deinit`: the Carbon refs are main-actor state and
    /// a nonisolated deinit cannot touch them. The agent's lifetime is the
    /// process's anyway, so teardown belongs at `applicationWillTerminate`.
    public func stop() {
        unregisterAll()
        if let eventHandler {
            RemoveEventHandler(eventHandler)
            self.eventHandler = nil
        }
    }
}
