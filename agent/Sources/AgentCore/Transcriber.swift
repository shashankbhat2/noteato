import AVFoundation
import FluidAudio
import Foundation

/// On-device transcription: Parakeet on the Apple Neural Engine, via FluidAudio.
///
/// **This is deliberately not held by the agent.** Transcribing peaks around
/// 133 MB (measured, see bench/README.md) and the agent already sits at 55 MB
/// with the microphone open, against a 150 MB budget. So this runs in a
/// short-lived helper that exits when it is done, and the resident process
/// stays lean by construction rather than by remembering to unload a model at
/// the right moment.
public enum Transcriber {
    /// Recorded into every transcript, so a note processed by a cloud model
    /// later can be told apart from one that never left the machine (§6).
    public static let engineName = "fluidaudio/parakeet-tdt-v3"

    public enum TranscribeError: Error, LocalizedError {
        case audioUnreadable(String)
        case modelUnavailable(String)

        public var errorDescription: String? {
            switch self {
            case .audioUnreadable(let detail): return "Could not read the audio: \(detail)"
            case .modelUnavailable(let detail):
                return
                    "The transcription model is unavailable: \(detail). It downloads once on first use and needs a network connection for that."
            }
        }
    }

    /// Transcribe an audio file, returning text plus word-level timings.
    public static func transcribe(audioAt url: URL) async throws -> Transcript {
        let models: AsrModels
        do {
            models = try await AsrModels.downloadAndLoad()
        } catch {
            throw TranscribeError.modelUnavailable("\(error)")
        }

        let duration: Double
        do {
            let file = try AVAudioFile(forReading: url)
            duration = Double(file.length) / file.fileFormat.sampleRate
        } catch {
            throw TranscribeError.audioUnreadable("\(error)")
        }

        let manager = AsrManager(config: .default, models: models)
        var state = try TdtDecoderState()
        // The URL overload resamples and, past a threshold, streams from disk
        // rather than holding the whole file — which is what keeps a long
        // meeting from costing memory proportional to its length.
        let result = try await manager.transcribe(url, decoderState: &state)

        let words = (result.tokenTimings.map { buildWordTimings(from: $0) } ?? [])
            .map { Transcript.Word(word: $0.word, start: $0.startTime, end: $0.endTime) }

        return Transcript(
            engine: engineName,
            durationSeconds: duration,
            text: result.text.trimmingCharacters(in: .whitespacesAndNewlines),
            words: words
        )
    }

    /// Transcribe a committed capture directory in place: writes
    /// `transcript.json` and retitles `note.md` from what was said.
    @discardableResult
    public static func process(noteDirectory: URL) async throws -> Transcript {
        let audio = noteDirectory.appendingPathComponent("audio.m4a")
        let note = noteDirectory.appendingPathComponent("note.md")

        let transcript = try await transcribe(audioAt: audio)
        try transcript.write(to: noteDirectory.appendingPathComponent("transcript.json"))

        if FileManager.default.fileExists(atPath: note.path) {
            try NoteUpdater.applyTranscript(
                to: note, transcript: transcript,
                // Keeps the capture's time-based name when there were no words
                // — silence should not become a note titled "Untitled".
                fallbackTitle: CaptureWriter.defaultTitle(for: Date()))
        }
        return transcript
    }
}
