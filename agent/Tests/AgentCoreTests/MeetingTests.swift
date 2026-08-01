import Foundation
import Testing

@testable import AgentCore

private func words(_ pairs: [(String, Double, Double)]) -> [Transcript.Word] {
    pairs.map { Transcript.Word(word: $0.0, start: $0.1, end: $0.2) }
}

private func channel(_ text: String, _ pairs: [(String, Double, Double)], duration: Double = 10)
    -> Transcript
{
    Transcript(engine: "test", durationSeconds: duration, text: text, words: words(pairs))
}

@Suite("Meeting transcript")
struct MeetingTranscriptTests {
    /// The design in one test: attribution comes from which device the audio
    /// arrived on, so it is exact rather than inferred (§8).
    @Test("attributes each side by the channel it came from")
    func attributionByChannel() {
        let mine = channel("hello there", [("hello", 0.0, 0.4), ("there", 0.4, 0.8)])
        let theirs = channel("hi yes", [("hi", 1.5, 1.8), ("yes", 1.8, 2.1)])

        let meeting = MeetingTranscript.merge(mine: mine, theirs: theirs, engine: "test")
        #expect(meeting.segments.filter { $0.speaker == .me }.count == 1)
        #expect(meeting.segments.filter { $0.speaker == .them }.count == 1)
        #expect(meeting.chronological.first?.speaker == .me)
        #expect(meeting.chronological.last?.speaker == .them)
    }

    @Test("reconstructs the order of an exchange from shared timestamps")
    func chronology() {
        // Both channels started at the same instant, so sorting on start time
        // rebuilds the conversation.
        let mine = channel("first third", [("first", 0.0, 0.5), ("third", 4.0, 4.5)])
        let theirs = channel("second", [("second", 2.0, 2.5)])

        let order = MeetingTranscript.merge(mine: mine, theirs: theirs, engine: "test")
            .chronological.map(\.text)
        #expect(order == ["first", "second", "third"])
    }

    @Test("keeps overlapping speech rather than smoothing it away")
    func overlaps() {
        // People talk over each other. That is information about the meeting,
        // not noise to be resolved.
        let mine = channel("as I was saying", [("as", 1.0, 1.2), ("I", 1.2, 1.4), ("was", 1.4, 1.6), ("saying", 1.6, 2.0)])
        let theirs = channel("sorry go ahead", [("sorry", 1.3, 1.6), ("go", 1.6, 1.8), ("ahead", 1.8, 2.1)])

        let meeting = MeetingTranscript.merge(mine: mine, theirs: theirs, engine: "test")
        #expect(meeting.segments.count == 2)
        let me = meeting.segments.first { $0.speaker == .me }!
        let them = meeting.segments.first { $0.speaker == .them }!
        #expect(them.start < me.end)  // genuinely overlapping, and both survive
    }

    @Test("breaks a channel into utterances at pauses")
    func pauseSplitting() {
        let mine = channel(
            "one two three four",
            [("one", 0.0, 0.3), ("two", 0.3, 0.6), ("three", 3.0, 3.3), ("four", 3.3, 3.6)])
        let segments = MeetingTranscript.segments(from: mine, speaker: .me)
        #expect(segments.count == 2)
        #expect(segments[0].text == "one two")
        #expect(segments[1].text == "three four")
    }

    @Test("keeps text that arrived without timings")
    func noTimings() {
        let mine = Transcript(engine: "test", durationSeconds: 3, text: "short clip", words: [])
        let segments = MeetingTranscript.segments(from: mine, speaker: .me)
        #expect(segments.count == 1)
        #expect(segments[0].text == "short clip")
    }

    @Test("drops a channel that heard nothing")
    func silentChannel() {
        // A meeting where nobody else spoke should not produce an empty
        // "Them" block.
        let mine = channel("just me", [("just", 0, 0.3), ("me", 0.3, 0.6)])
        let theirs = Transcript(engine: "test", durationSeconds: 5, text: "", words: [])
        let meeting = MeetingTranscript.merge(mine: mine, theirs: theirs, engine: "test")
        #expect(meeting.segments.allSatisfy { $0.speaker == .me })
    }

    @Test("renaming a side sticks, and only that side")
    func renaming() {
        var meeting = MeetingTranscript.merge(
            mine: channel("hello", [("hello", 0, 0.4)]),
            theirs: channel("hi", [("hi", 1, 1.3)]), engine: "test")
        for i in meeting.segments.indices where meeting.segments[i].speaker == .them {
            meeting.segments[i].label = "Priya"
        }
        #expect(meeting.chronological.last?.displayName() == "Priya")
        #expect(meeting.chronological.first?.displayName() == "Me")
    }

    @Test("renders markdown with timestamps that point into the audio")
    func markdown() {
        let meeting = MeetingTranscript.merge(
            mine: channel("hello there", [("hello", 0, 0.4), ("there", 0.4, 0.9)]),
            theirs: channel("hi", [("hi", 75, 75.4)]), engine: "test")
        let text = meeting.markdown()

        #expect(text.contains("**Me** · 0:00"))
        // Past a minute, so the mm:ss formatting is doing real work.
        #expect(text.contains("**Them** · 1:15"))
        #expect(text.contains("hello there"))
    }

    @Test("round-trips through JSON")
    func roundTrip() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("m-\(UUID().uuidString.prefix(8)).json")
        defer { try? FileManager.default.removeItem(at: url) }

        let meeting = MeetingTranscript.merge(
            mine: channel("hello", [("hello", 0, 0.4)]),
            theirs: channel("hi", [("hi", 1, 1.3)]), engine: "test")
        try meeting.write(to: url)
        #expect(try MeetingTranscript.read(from: url) == meeting)
    }
}

@Suite("System audio")
struct SystemAudioTests {
    @Test("permission can be checked without prompting")
    func permissionCheckIsSilent() {
        // §8 says the meeting prompt appears only after explicit opt-in, which
        // is impossible to honour if merely asking pops a dialog.
        _ = SystemAudioCapture.hasPermission
    }

    @Test("starts not recording")
    func startsIdle() {
        #expect(SystemAudioCapture().isRecording == false)
        #expect(SystemAudioCapture().capturedSeconds == 0)
    }

    @Test("stopping when never started is harmless")
    func stopWithoutStart() async {
        let capture = SystemAudioCapture()
        #expect(await capture.stop().isEmpty)
    }
}
