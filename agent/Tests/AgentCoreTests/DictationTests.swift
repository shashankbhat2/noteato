import Foundation
import Testing

@testable import AgentCore

/// Spacing is the only text dictation adds to what the user actually said, so
/// it is the only place this feature can put words in their mouth. §7 asks for
/// verbatim-leaning output; these pin down how literally that is meant.
@Suite("Dictation spacing")
struct DictationSpacingTests {
    @Test("adds a separating space between phrases")
    func separatesPhrases() {
        #expect(DictationSpacing.prepare("there", precededBy: "hello") == " there")
    }

    @Test("adds nothing at the start of an empty field")
    func firstPhrase() {
        #expect(DictationSpacing.prepare("hello", precededBy: nil) == "hello")
        #expect(DictationSpacing.prepare("hello", precededBy: "") == "hello")
    }

    @Test("does not double a space that is already there")
    func existingSpace() {
        #expect(DictationSpacing.prepare("there", precededBy: "hello ") == "there")
        #expect(DictationSpacing.prepare("there", precededBy: "hello\n") == "there")
    }

    @Test("does not push punctuation away from the word it belongs to")
    func punctuation() {
        // " ." would leave a floating full stop in someone's sentence.
        #expect(DictationSpacing.prepare(".", precededBy: "done") == ".")
        #expect(DictationSpacing.prepare(", then", precededBy: "first") == ", then")
        #expect(DictationSpacing.prepare("?", precededBy: "really") == "?")
    }

    @Test("does not separate from an opening bracket or quote")
    func openingDelimiters() {
        #expect(DictationSpacing.prepare("hello", precededBy: "(") == "hello")
        #expect(DictationSpacing.prepare("hello", precededBy: "\"") == "hello")
    }

    @Test("trims the phrase but never rewrites it")
    func trimsOnly() {
        // Whitespace the decoder happened to emit is not content. Everything
        // else is left exactly as it was heard — no capitalisation, no
        // punctuation invented, no words changed.
        #expect(DictationSpacing.prepare("  hello  ", precededBy: nil) == "hello")
        #expect(
            DictationSpacing.prepare("um so like the thing is", precededBy: nil)
                == "um so like the thing is")
        #expect(DictationSpacing.prepare("i think its fine", precededBy: nil) == "i think its fine")
    }

    @Test("an empty or whitespace-only phrase produces nothing")
    func emptyPhrase() {
        #expect(DictationSpacing.prepare("", precededBy: "hello").isEmpty)
        #expect(DictationSpacing.prepare("   \n ", precededBy: "hello").isEmpty)
    }

    @Test("builds a sentence correctly across several phrases")
    func runningSentence() {
        // What the session actually does: accumulate, deciding each separator
        // from what is already in front of the caret.
        var typed = ""
        for phrase in ["Ship the migration", "behind a flag", ".", "Tell the team"] {
            typed += DictationSpacing.prepare(phrase, precededBy: typed.isEmpty ? nil : typed)
        }
        #expect(typed == "Ship the migration behind a flag. Tell the team")
    }
}

@Suite("Dictation session")
struct DictationSessionTests {
    @Test("starts idle and reports its state")
    func startsIdle() async {
        let session = DictationSession()
        #expect(await session.currentState() == .idle)
    }

    @Test("feeding audio while idle is a no-op rather than an error")
    func audioWhileIdle() async {
        // The microphone tap is always running; dictation just is not always
        // listening to it.
        let session = DictationSession()
        await session.accept(samples: [0.1, 0.2, 0.3], sampleRate: 48_000)
        #expect(await session.currentState() == .idle)
    }

    @Test("stopping when never started is harmless")
    func stopWithoutStart() async {
        let session = DictationSession()
        #expect(await session.stop().isEmpty)
        #expect(await session.currentState() == .idle)
    }
}

@Suite("Text injection")
struct TextInjectorTests {
    @MainActor
    @Test("reports whether it may drive other apps")
    func permissionIsReadable() {
        // Whatever the answer, the caller has to be able to ask — a dictation
        // key that silently does nothing is unexplainable from the user's side.
        _ = TextInjector.hasAccessibilityPermission
    }

    @MainActor
    @Test("refuses to inject nothing")
    func emptyInsert() {
        #expect(TextInjector.insert("") == .failed)
    }
}
