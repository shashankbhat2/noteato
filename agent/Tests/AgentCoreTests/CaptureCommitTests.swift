import AVFoundation
import Foundation
import Testing

@testable import AgentCore

/// Generates `seconds` of a sine at `frequency`, so a test can look for a known
/// tone in audio that came back out the other end.
private func tone(frequency: Double, seconds: Double, sampleRate: Double, amplitude: Float = 0.6)
    -> [Float]
{
    let count = Int(seconds * sampleRate)
    return (0..<count).map { i in
        amplitude * Float(sin(2 * .pi * frequency * Double(i) / sampleRate))
    }
}

/// Crude single-bin Goertzel: how strongly `frequency` is present in `samples`.
/// Enough to answer "is the tone in there", which is all these tests ask.
private func energy(at frequency: Double, in samples: [Float], sampleRate: Double) -> Double {
    guard samples.count > 1 else { return 0 }
    let k = 2 * cos(2 * .pi * frequency / sampleRate)
    var s1 = 0.0
    var s2 = 0.0
    for sample in samples {
        let s0 = Double(sample) + k * s1 - s2
        s2 = s1
        s1 = s0
    }
    let power = s1 * s1 + s2 * s2 - k * s1 * s2
    return sqrt(max(power, 0)) / Double(samples.count)
}

@Suite("Pre-roll capture")
struct PreRollCaptureTests {
    private let rate: Double = 48_000

    /// THE test for this phase.
    ///
    /// A tone plays and *stops*. Only afterwards does the user hit the hotkey.
    /// Every other tool would have missed it entirely; the committed audio has
    /// to contain it, because recording began ten seconds in the past.
    @Test("a capture contains audio that happened before the hotkey")
    func captureIncludesAudioFromBeforeTheKeypress() {
        let buffer = PreRollBuffer(seconds: 10, sampleRate: rate)

        // 1. A thought, spoken before anyone pressed anything.
        let spoken = tone(frequency: 440, seconds: 2, sampleRate: rate)
        buffer.write(spoken)

        // 2. A beat of silence — the reach for the keyboard.
        buffer.write([Float](repeating: 0, count: Int(0.5 * rate)))

        // 3. The hotkey. Capture opens with whatever the buffer holds.
        var captured = buffer.snapshot()

        // 4. More speech, at a different pitch, after the key.
        let after = tone(frequency: 880, seconds: 1, sampleRate: rate)
        captured.append(contentsOf: after)

        let before440 = energy(at: 440, in: captured, sampleRate: rate)
        let after880 = energy(at: 880, in: captured, sampleRate: rate)
        let absent1500 = energy(at: 1500, in: captured, sampleRate: rate)

        // Both halves are present, and a frequency never played is not.
        #expect(before440 > absent1500 * 10)
        #expect(after880 > absent1500 * 10)
        // ~3.5s: 2s speech + 0.5s silence + 1s after.
        #expect(abs(Double(captured.count) / rate - 3.5) < 0.01)
    }

    @Test("pre-roll longer than the buffer keeps only the most recent seconds")
    func preRollIsBounded() {
        let buffer = PreRollBuffer(seconds: 2, sampleRate: rate)
        buffer.write(tone(frequency: 300, seconds: 3, sampleRate: rate))  // falls out
        buffer.write(tone(frequency: 900, seconds: 2, sampleRate: rate))  // survives

        let captured = buffer.snapshot()
        #expect(abs(Double(captured.count) / rate - 2) < 0.01)
        #expect(
            energy(at: 900, in: captured, sampleRate: rate)
                > energy(at: 300, in: captured, sampleRate: rate) * 10)
    }

    @Test("a discarded capture leaves nothing behind")
    func discardLeavesNothing() {
        // Cmd+Esc. The buffer is cleared, so the next capture cannot open with
        // audio from the one the user threw away.
        let buffer = PreRollBuffer(seconds: 10, sampleRate: rate)
        buffer.write(tone(frequency: 440, seconds: 2, sampleRate: rate))
        buffer.reset()

        #expect(buffer.snapshot().isEmpty)
        buffer.write(tone(frequency: 880, seconds: 0.5, sampleRate: rate))
        let next = buffer.snapshot()
        #expect(
            energy(at: 880, in: next, sampleRate: rate)
                > energy(at: 440, in: next, sampleRate: rate) * 10)
    }
}

@Suite("CaptureWriter")
struct CaptureWriterTests {
    private let rate: Double = 48_000

    private func makeVault() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("noteato-capture-\(UUID().uuidString.prefix(8))")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test("writes a note directory holding audio and markdown")
    func writesNoteDirectory() throws {
        let vault = makeVault()
        defer { try? FileManager.default.removeItem(at: vault) }

        let committed = try CaptureWriter.commit(
            samples: tone(frequency: 440, seconds: 1, sampleRate: rate),
            sampleRate: rate, vault: vault)

        #expect(FileManager.default.fileExists(atPath: committed.audio.path))
        #expect(FileManager.default.fileExists(atPath: committed.note.path))
        #expect(committed.audio.lastPathComponent == "audio.m4a")
        #expect(committed.note.lastPathComponent == "note.md")
        #expect(abs(committed.duration - 1) < 0.01)

        // Phases 3 and 4 add these; nothing writes a placeholder for them,
        // because an empty transcript reads the same as a failed one.
        let contents = try FileManager.default.contentsOfDirectory(atPath: committed.directory.path)
        #expect(Set(contents) == ["audio.m4a", "note.md"])
    }

    @Test("the audio survives the round trip through AAC")
    func audioRoundTrips() throws {
        let vault = makeVault()
        defer { try? FileManager.default.removeItem(at: vault) }

        let committed = try CaptureWriter.commit(
            samples: tone(frequency: 440, seconds: 1, sampleRate: rate),
            sampleRate: rate, vault: vault)

        // Read the file back and confirm the tone is really in it — the point
        // being that the encoder ran, not just that a file appeared.
        let file = try AVAudioFile(forReading: committed.audio)
        #expect(abs(file.fileFormat.sampleRate - rate) < 1)

        let pcmFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32, sampleRate: file.fileFormat.sampleRate, channels: 1,
            interleaved: false)!
        let pcm = AVAudioPCMBuffer(
            pcmFormat: pcmFormat, frameCapacity: AVAudioFrameCount(file.length))!
        try file.read(into: pcm)

        let decoded = Array(
            UnsafeBufferPointer(start: pcm.floatChannelData![0], count: Int(pcm.frameLength)))
        #expect(decoded.count > Int(rate) / 2)
        #expect(
            energy(at: 440, in: decoded, sampleRate: rate)
                > energy(at: 1500, in: decoded, sampleRate: rate) * 5)
    }

    @Test("directory names sort chronologically and do not collide")
    func directoryNaming() {
        let earlier = CaptureWriter.directoryName(at: Date(timeIntervalSince1970: 1_000_000))
        let later = CaptureWriter.directoryName(at: Date(timeIntervalSince1970: 2_000_000))
        #expect(earlier < later)

        // Two captures in the same second must not land on one directory.
        let now = Date()
        let names = Set((0..<200).map { _ in CaptureWriter.directoryName(at: now) })
        #expect(names.count > 190)
    }

    @Test("the directory name does not depend on the title")
    func nameIsTitleIndependent() throws {
        // The property Phase 1.5 established, applied to disk: a rename must
        // never move a note, so its location cannot encode its title.
        let vault = makeVault()
        defer { try? FileManager.default.removeItem(at: vault) }
        let date = Date()
        let samples = tone(frequency: 440, seconds: 0.5, sampleRate: rate)

        let a = try CaptureWriter.commit(
            samples: samples, sampleRate: rate, vault: vault, date: date, title: "Something short")
        let b = try CaptureWriter.commit(
            samples: samples, sampleRate: rate, vault: vault, date: date,
            title: "A completely different and much longer title")

        for url in [a.directory, b.directory] {
            #expect(!url.lastPathComponent.lowercased().contains("something"))
            #expect(!url.lastPathComponent.lowercased().contains("different"))
        }
    }

    @Test("refuses to write an empty capture")
    func refusesEmpty() {
        let vault = makeVault()
        defer { try? FileManager.default.removeItem(at: vault) }
        #expect(throws: CaptureWriter.WriteError.self) {
            _ = try CaptureWriter.commit(samples: [], sampleRate: rate, vault: vault)
        }
    }

    @Test("the note carries front matter the library already understands")
    func frontMatterMatchesLibrary() {
        let markdown = CaptureWriter.noteMarkdown(date: Date(), duration: 12, title: "Test note")
        for field in ["id:", "title:", "createdAt:", "updatedAt:", "tags:", "pinned:", "reminderAt:"]
        {
            #expect(markdown.contains(field))
        }
        #expect(markdown.contains("source: capture"))
        #expect(markdown.contains("durationSeconds: 12"))
        #expect(markdown.contains("# Test note"))
    }
}
