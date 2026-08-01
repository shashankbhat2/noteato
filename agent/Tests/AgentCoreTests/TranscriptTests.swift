import Foundation
import Testing

@testable import AgentCore

private func stubNote(title: String = "Capture 1 Aug, 14:32", body: String? = nil) -> String {
    """
    ---
    id: 1111-2222
    title: "\(title)"
    createdAt: 2026-08-01T14:32:11.000Z
    updatedAt: 2026-08-01T14:32:11.000Z
    tags: []
    fullWidth: false
    pinned: false
    reminderAt: \n\
    source: capture
    durationSeconds: 7
    ---

    \(body ?? "# \(title)")
    """
}

private func transcript(_ text: String) -> Transcript {
    Transcript(
        engine: "test", durationSeconds: 5, text: text,
        words: text.split(separator: " ").enumerated().map {
            Transcript.Word(word: String($1), start: Double($0) * 0.3, end: Double($0) * 0.3 + 0.25)
        })
}

private func write(_ contents: String) -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("note-\(UUID().uuidString.prefix(8)).md")
    try! contents.write(to: url, atomically: true, encoding: .utf8)
    return url
}

@Suite("Transcript file")
struct TranscriptFileTests {
    @Test("round-trips through JSON with its word timings")
    func roundTrip() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("t-\(UUID().uuidString.prefix(8)).json")
        defer { try? FileManager.default.removeItem(at: url) }

        let original = transcript("one two three")
        try original.write(to: url)
        #expect(try Transcript.read(from: url) == original)
    }

    @Test("records which engine produced it")
    func recordsEngine() {
        // §6 requires a note processed remotely to be labelled. That starts
        // with the transcript saying what made it.
        #expect(transcript("hello").engine == "test")
        #expect(Transcriber.engineName.contains("parakeet"))
    }
}

@Suite("Title from transcript")
struct TitleTests {
    @Test("uses the opening words")
    func openingWords() {
        let title = NoteUpdater.title(
            from: "Remember to ask the team about the migration plan before Friday",
            fallback: "Capture")
        #expect(title == "Remember to ask the team about the migration plan")
    }

    @Test("stops at a sentence boundary when there is a near one")
    func sentenceBoundary() {
        let title = NoteUpdater.title(
            from: "Call the plumber back. Then look at the invoice from March.", fallback: "Capture")
        #expect(title == "Call the plumber back")
    }

    @Test("ignores a sentence boundary too early to be a title")
    func tooShortBoundary() {
        // "Ok." is a stop, but not a name for anything.
        let title = NoteUpdater.title(
            from: "Ok. So the thing I keep forgetting is the renewal date", fallback: "Capture")
        #expect(title != "Ok")
        #expect(title.count > 3)
    }

    @Test("falls back when there were no words")
    func silence() {
        #expect(NoteUpdater.title(from: "", fallback: "Capture 1 Aug") == "Capture 1 Aug")
        #expect(NoteUpdater.title(from: "   \n ", fallback: "Capture 1 Aug") == "Capture 1 Aug")
    }

    @Test("does not end mid-breath on a comma")
    func trailingPunctuation() {
        let title = NoteUpdater.title(
            from: "First thing tomorrow, before anything else, check the deploy",
            fallback: "Capture")
        #expect(!title.hasSuffix(","))
    }

    @Test("truncates a title that would run away")
    func longTitle() {
        let title = NoteUpdater.title(
            from: String(repeating: "supercalifragilistic ", count: 20), fallback: "Capture")
        #expect(title.count <= 73)
    }
}

@Suite("Applying a transcript to a note")
struct ApplyTranscriptTests {
    @Test("fills an untouched capture with what was said")
    func fillsStub() throws {
        let url = write(stubNote())
        defer { try? FileManager.default.removeItem(at: url) }

        try NoteUpdater.applyTranscript(
            to: url, transcript: transcript("Ask about the migration plan"), fallbackTitle: "Capture")
        let result = try String(contentsOf: url, encoding: .utf8)

        #expect(result.contains("title: \"Ask about the migration plan\""))
        #expect(result.contains("# Ask about the migration plan"))
        #expect(result.contains("\nAsk about the migration plan\n"))
        #expect(result.contains("transcribed: true"))
    }

    /// The one that matters: transcription is asynchronous, so a user can be
    /// typing into a note while it runs. Their words win.
    @Test("never overwrites something the user has already written")
    func preservesUserWriting() throws {
        let typed = """
            # Capture 1 Aug, 14:32

            I already started writing this up myself.

            - one thing
            - another thing
            """
        let url = write(stubNote(body: typed))
        defer { try? FileManager.default.removeItem(at: url) }

        try NoteUpdater.applyTranscript(
            to: url, transcript: transcript("Something completely different was said"),
            fallbackTitle: "Capture")
        let result = try String(contentsOf: url, encoding: .utf8)

        #expect(result.contains("I already started writing this up myself."))
        #expect(result.contains("- another thing"))
        // The title still updates — it was a placeholder, not something the
        // user wrote — but the transcript is not appended to their text. It
        // appears once, as the heading, and nowhere in the body.
        #expect(result.contains("# Something completely different was said"))

        // In the body it appears only as the heading — the transcript is not
        // appended under the user's writing.
        let body = result.components(separatedBy: "---\n\n").last ?? ""
        let inBody = body.components(separatedBy: "Something completely different was said").count - 1
        #expect(inBody == 1)
        #expect(body.hasPrefix("# Something completely different was said"))
    }

    @Test("keeps front matter and heading titles in step")
    func titlesStayInStep() throws {
        // The library derives one from the other; changing only one produces a
        // note whose name depends on which surface you look at.
        let url = write(stubNote())
        defer { try? FileManager.default.removeItem(at: url) }

        try NoteUpdater.applyTranscript(
            to: url, transcript: transcript("Book the venue for the offsite"), fallbackTitle: "X")
        let result = try String(contentsOf: url, encoding: .utf8)

        #expect(result.contains("title: \"Book the venue for the offsite\""))
        #expect(result.contains("# Book the venue for the offsite"))
    }

    @Test("escapes a quote in the title rather than breaking front matter")
    func escapesQuotes() throws {
        let url = write(stubNote())
        defer { try? FileManager.default.removeItem(at: url) }

        try NoteUpdater.applyTranscript(
            to: url, transcript: transcript("She said \"ship it\" and left the room"),
            fallbackTitle: "X")
        let result = try String(contentsOf: url, encoding: .utf8)
        #expect(result.contains("\\\"ship it\\\""))
    }

    @Test("writes the blank line the library's own serializer writes")
    func frontMatterSpacing() throws {
        let url = write(stubNote())
        defer { try? FileManager.default.removeItem(at: url) }
        try NoteUpdater.applyTranscript(
            to: url, transcript: transcript("Hello there"), fallbackTitle: "X")
        let result = try String(contentsOf: url, encoding: .utf8)
        #expect(result.contains("---\n\n# Hello there"))
    }

    @Test("silence leaves the capture's own name in place")
    func silentCapture() throws {
        let url = write(stubNote())
        defer { try? FileManager.default.removeItem(at: url) }
        try NoteUpdater.applyTranscript(
            to: url, transcript: transcript(""), fallbackTitle: "Capture 1 Aug, 14:32")
        let result = try String(contentsOf: url, encoding: .utf8)
        #expect(result.contains("title: \"Capture 1 Aug, 14:32\""))
    }
}
