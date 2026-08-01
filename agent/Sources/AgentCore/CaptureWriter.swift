import AVFoundation
import Foundation

/// Writes a committed capture to disk in the note layout the revamp brief §4.3
/// describes:
///
/// ```
/// <vault>/2026-08-01T14-32-11Z-a7f3/
///   audio.m4a          source of truth
///   note.md            derived, regenerable from audio + transcript
/// ```
///
/// The directory name is a timestamp plus a short random suffix, and is never
/// derived from the note's title. That is what makes a rename free: the note
/// keeps its location for life, so nothing holding a reference to it can be
/// invalidated by an edit — the same property Phase 1.5 established in the
/// library, applied to the on-disk layout.
///
/// `transcript.json` and `embeddings.bin` arrive in Phases 3 and 4. Nothing
/// here writes a placeholder for them: an empty transcript is indistinguishable
/// from a failed one, and the reconciler should see absence, not a stub.
public enum CaptureWriter {
    public struct Committed: Sendable {
        public let directory: URL
        public let audio: URL
        public let note: URL
        public let duration: Double
    }

    public enum WriteError: Error {
        case noAudio
        case formatUnavailable
        case encoderUnavailable
    }

    /// A directory name that sorts chronologically and cannot collide.
    /// Colons are illegal in a path component, so the ISO time uses dashes.
    public static func directoryName(at date: Date = Date(), random: String? = nil) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH-mm-ss'Z'"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let suffix = random ?? String(UUID().uuidString.prefix(4)).lowercased()
        return "\(formatter.string(from: date))-\(suffix)"
    }

    /// Write `samples` as AAC in an m4a container, alongside a note stub.
    ///
    /// The note's front matter carries the same fields the markdown library
    /// already uses, so a captured note is an ordinary note the moment it
    /// lands — not a second kind of thing the rest of the app has to learn.
    public static func commit(
        samples: [Float],
        sampleRate: Double,
        vault: URL,
        date: Date = Date(),
        title: String? = nil
    ) throws -> Committed {
        guard !samples.isEmpty else { throw WriteError.noAudio }

        let directory = vault.appendingPathComponent(directoryName(at: date))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let audioURL = directory.appendingPathComponent("audio.m4a")
        try writeAAC(samples: samples, sampleRate: sampleRate, to: audioURL)

        let duration = Double(samples.count) / sampleRate
        let noteURL = directory.appendingPathComponent("note.md")
        try noteMarkdown(date: date, duration: duration, title: title)
            .write(to: noteURL, atomically: true, encoding: .utf8)

        return Committed(directory: directory, audio: audioURL, note: noteURL, duration: duration)
    }

    /// Front matter matching the library's existing shape, so nothing
    /// downstream needs a special case for captured notes.
    static func noteMarkdown(date: Date, duration: Double, title: String?) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let stamp = iso.string(from: date)
        let heading = title ?? defaultTitle(for: date)
        let seconds = Int(duration.rounded())

        return """
            ---
            id: \(UUID().uuidString)
            title: "\(heading.replacingOccurrences(of: "\"", with: "\\\""))"
            createdAt: \(stamp)
            updatedAt: \(stamp)
            tags: []
            fullWidth: false
            pinned: false
            reminderAt: \n\
            source: capture
            durationSeconds: \(seconds)
            ---

            # \(heading)

            """
    }

    /// A capture has no title until something transcribes it. The time it was
    /// taken is the honest placeholder — better than "Untitled", and it is
    /// replaced by Phase 3 once there are words to name it with.
    static func defaultTitle(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d MMM, HH:mm"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return "Capture \(formatter.string(from: date))"
    }

    // MARK: - Encoding

    static func writeAAC(samples: [Float], sampleRate: Double, to url: URL) throws {
        guard
            let sourceFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1,
                interleaved: false)
        else { throw WriteError.formatUnavailable }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            // Speech, mono. Higher rates cost disk for detail a voice note does
            // not carry, and this is audio people will keep for years.
            AVEncoderBitRateKey: 64_000
        ]

        let file = try AVAudioFile(forWriting: url, settings: settings)

        // Write in chunks so a long capture doesn't need one enormous buffer.
        let chunkFrames = 8192
        var offset = 0
        while offset < samples.count {
            let count = min(chunkFrames, samples.count - offset)
            guard
                let pcm = AVAudioPCMBuffer(
                    pcmFormat: sourceFormat, frameCapacity: AVAudioFrameCount(count))
            else { throw WriteError.encoderUnavailable }
            pcm.frameLength = AVAudioFrameCount(count)
            samples.withUnsafeBufferPointer { src in
                pcm.floatChannelData![0].update(from: src.baseAddress! + offset, count: count)
            }
            try file.write(from: pcm)
            offset += count
        }
        return
    }
}
