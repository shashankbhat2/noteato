import Foundation

/// Writes a meeting: two audio channels kept separate, plus the merged
/// transcript that reads as one conversation.
///
/// ```
/// <vault>/2026-08-01T14-32-11Z-a7f3/
///   audio.m4a           the mic — you
///   audio-system.m4a    system audio — them
///   meeting.json        merged, attributed, with timings
///   note.md
/// ```
///
/// The channels stay as separate files rather than being mixed down. Mixing
/// would throw away the very thing that makes attribution exact, and §8 wants
/// the audio replayable — "being able to scrub back to what was actually said
/// is the loudest unmet complaint in this category." A mixed file cannot be
/// re-attributed later; two files can be re-transcribed forever.
public enum MeetingWriter {
    public struct Committed: Sendable {
        public let directory: URL
        public let micAudio: URL
        public let systemAudio: URL?
        public let note: URL
        public let duration: Double
    }

    public static func commit(
        mic: [Float],
        system: [Float],
        sampleRate: Double,
        vault: URL,
        date: Date = Date()
    ) throws -> Committed {
        guard !mic.isEmpty || !system.isEmpty else { throw CaptureWriter.WriteError.noAudio }

        let directory = vault.appendingPathComponent(CaptureWriter.directoryName(at: date))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let micURL = directory.appendingPathComponent("audio.m4a")
        try CaptureWriter.writeAAC(samples: mic, sampleRate: sampleRate, to: micURL)

        var systemURL: URL?
        if !system.isEmpty {
            let url = directory.appendingPathComponent("audio-system.m4a")
            try CaptureWriter.writeAAC(samples: system, sampleRate: sampleRate, to: url)
            systemURL = url
        }

        let duration = Double(max(mic.count, system.count)) / sampleRate
        let noteURL = directory.appendingPathComponent("note.md")
        try noteMarkdown(date: date, duration: duration)
            .write(to: noteURL, atomically: true, encoding: .utf8)

        return Committed(
            directory: directory, micAudio: micURL, systemAudio: systemURL, note: noteURL,
            duration: duration)
    }

    /// `source: meeting` is what lets the library tell a meeting from a voice
    /// note without opening either — and what a later transcription pass keys
    /// on to know there are two channels to merge.
    static func noteMarkdown(date: Date, duration: Double) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let stamp = iso.string(from: date)
        let formatter = DateFormatter()
        formatter.dateFormat = "d MMM, HH:mm"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let heading = "Meeting \(formatter.string(from: date))"

        return """
            ---
            id: \(UUID().uuidString)
            title: "\(heading)"
            createdAt: \(stamp)
            updatedAt: \(stamp)
            tags: []
            fullWidth: false
            pinned: false
            reminderAt: \n\
            source: meeting
            durationSeconds: \(Int(duration.rounded()))
            ---

            # \(heading)

            """
    }
}
