import Foundation

/// A meeting's transcript: two channels, each attributed by where it came from.
///
/// Speaker labels here are `.me` and `.them` and nothing else. That is the
/// whole design (§8): the microphone is you and the system audio is the other
/// side, so attribution is a fact about which device the samples arrived on
/// rather than an inference from how a voice sounds. It cannot drift, cannot be
/// fooled by two similar voices, and needs no threshold anyone has to tune.
///
/// `label` exists so "Speaker 2" can be renamed to a person's name after the
/// fact and have that stick, which §8 asks for — but renaming is the user's
/// act, not the model's guess.
public struct MeetingTranscript: Codable, Equatable, Sendable {
    public enum Speaker: String, Codable, Sendable {
        case me
        case them
    }

    public struct Segment: Codable, Equatable, Sendable {
        public let speaker: Speaker
        /// What the user renamed this side to, if they did. Nil means the
        /// default name for the speaker is used.
        public var label: String?
        public let start: Double
        public let end: Double
        public let text: String

        public init(
            speaker: Speaker, label: String? = nil, start: Double, end: Double, text: String
        ) {
            self.speaker = speaker
            self.label = label
            self.start = start
            self.end = end
            self.text = text
        }

        public func displayName(myName: String = "Me", theirName: String = "Them") -> String {
            label ?? (speaker == .me ? myName : theirName)
        }
    }

    public var version: Int
    public var engine: String
    public var durationSeconds: Double
    public var segments: [Segment]

    public init(
        version: Int = 1, engine: String, durationSeconds: Double, segments: [Segment]
    ) {
        self.version = version
        self.engine = engine
        self.durationSeconds = durationSeconds
        self.segments = segments
    }

    /// Segments in the order they were said, regardless of which side said them.
    public var chronological: [Segment] {
        segments.sorted { $0.start < $1.start }
    }

    /// Interleave two single-channel transcripts into one conversation.
    ///
    /// Both channels were recorded simultaneously from the same instant, so
    /// their timestamps share an origin and sorting on `start` reconstructs the
    /// exchange — including the overlaps, which are real and worth keeping
    /// rather than smoothing away.
    public static func merge(
        mine: Transcript, theirs: Transcript, engine: String
    ) -> MeetingTranscript {
        let mineSegments = segments(from: mine, speaker: .me)
        let theirSegments = segments(from: theirs, speaker: .them)
        return MeetingTranscript(
            engine: engine,
            durationSeconds: max(mine.durationSeconds, theirs.durationSeconds),
            segments: (mineSegments + theirSegments).sorted { $0.start < $1.start }
        )
    }

    /// Group a word stream into utterances, breaking on a pause.
    ///
    /// A meeting transcript of individual words is unreadable, and a single
    /// block per channel loses the exchange. A gap is the honest boundary: it
    /// is where the person actually stopped talking.
    static func segments(
        from transcript: Transcript, speaker: Speaker, pauseSeconds: Double = 0.9
    ) -> [Segment] {
        guard !transcript.words.isEmpty else {
            // No timings (a very short clip, or an engine that gave none) —
            // keep the text rather than dropping it on the floor.
            let text = transcript.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return [] }
            return [
                Segment(speaker: speaker, start: 0, end: transcript.durationSeconds, text: text)
            ]
        }

        var out: [Segment] = []
        var current: [Transcript.Word] = []

        func flush() {
            guard let first = current.first, let last = current.last else { return }
            out.append(
                Segment(
                    speaker: speaker, start: first.start, end: last.end,
                    text: current.map(\.word).joined(separator: " ")))
            current = []
        }

        for word in transcript.words {
            if let previous = current.last, word.start - previous.end >= pauseSeconds {
                flush()
            }
            current.append(word)
        }
        flush()
        return out
    }

    /// Markdown for the note body: who said what, in order, with timestamps
    /// that point back into the audio (§9's traceability, at segment level).
    public func markdown(myName: String = "Me", theirName: String = "Them") -> String {
        chronological.map { segment in
            let stamp = MeetingTranscript.timestamp(segment.start)
            return "**\(segment.displayName(myName: myName, theirName: theirName))** "
                + "· \(stamp)\n\n\(segment.text)\n"
        }.joined(separator: "\n")
    }

    static func timestamp(_ seconds: Double) -> String {
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    public func write(to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(self).write(to: url, options: .atomic)
    }

    public static func read(from url: URL) throws -> MeetingTranscript {
        try JSONDecoder().decode(MeetingTranscript.self, from: Data(contentsOf: url))
    }
}
