import Foundation

/// The slice of Noteato's settings the agent needs.
///
/// Read from the same `settings.json` the Electron app writes, rather than kept
/// separately: two files describing one preference is how a UI ends up claiming
/// a pre-roll length the microphone is not actually using. Electron owns the
/// file; the agent only reads it, and re-reads on every access so a change in
/// Settings takes effect without restarting the agent.
public struct AgentSettings: Sendable {
    public var preRollSeconds: Double
    public var notesDirectory: URL

    public static let defaultPreRoll: Double = 10

    public static func settingsURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        // Electron's userData for this app; `noteato` is the productName it
        // uses, so this matches app.getPath('userData').
        return base.appendingPathComponent("noteato/settings.json")
    }

    public static func defaultNotesDirectory() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Noteato")
    }

    public static func load() -> AgentSettings {
        var preRoll = defaultPreRoll
        var notes = defaultNotesDirectory()

        if let data = try? Data(contentsOf: settingsURL()),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            if let seconds = json["preRollSeconds"] as? Double {
                preRoll = min(max(seconds, 0), 15)
            }
            // `notesDir` is null until the user picks one, which is why this is
            // a conditional cast rather than a default-coalescing read.
            if let dir = json["notesDir"] as? String, !dir.isEmpty {
                notes = URL(fileURLWithPath: dir)
            }
        }
        return AgentSettings(preRollSeconds: preRoll, notesDirectory: notes)
    }
}
