import AVFoundation
import FluidAudio
import Foundation

/// Live dictation into whatever app is in front.
///
/// The brief's strategic point (§7) is that nobody opens a notes app twenty
/// times a day but everybody types into something twenty times a day — so this
/// is a headline feature, not a utility. What that means concretely:
///
/// **Only confirmed text is injected.** The streaming decoder emits volatile
/// hypotheses that it revises as more audio arrives. Injecting those would make
/// words appear and then silently change in the user's own document, which is
/// exactly the "silent editorializing" §7 says people notice and resent. Text
/// lands once, and once it lands it is theirs.
///
/// The model is loaded per session and released at the end, for the same reason
/// transcription runs out of process: the agent has 150 MB to live in.
public actor DictationSession {
    public enum State: Sendable, Equatable {
        case idle
        case preparing
        case listening
        case failed(String)
    }

    private var manager: SlidingWindowAsrManager?
    private var pump: Task<Void, Never>?
    private var state: State = .idle
    /// Everything injected so far this session, so spacing can be decided from
    /// what is actually in front of the caret rather than guessed.
    private var injectedSoFar = ""

    /// Confirmed phrases, ready to be typed. The consumer injects; this actor
    /// deliberately does not touch other apps itself.
    public var onPhrase: (@Sendable (String) -> Void)?
    public var onStateChange: (@Sendable (State) -> Void)?

    public init() {}

    public func currentState() -> State { state }

    public func setHandlers(
        onPhrase: @escaping @Sendable (String) -> Void,
        onStateChange: @escaping @Sendable (State) -> Void
    ) {
        self.onPhrase = onPhrase
        self.onStateChange = onStateChange
    }

    private func transition(_ next: State) {
        state = next
        onStateChange?(next)
    }

    public func start() async {
        guard state == .idle else { return }
        transition(.preparing)
        injectedSoFar = ""

        do {
            let asr = SlidingWindowAsrManager()
            // The models are already on disk after the first capture; this is
            // the warm 0.13s path rather than a download.
            try await asr.loadModels(AsrModels.downloadAndLoad())
            try await asr.startStreaming(source: .microphone)
            manager = asr

            pump = Task { [weak self] in
                for await update in await asr.transcriptionUpdates {
                    guard !Task.isCancelled else { return }
                    await self?.handle(update)
                }
            }
            transition(.listening)
        } catch {
            manager = nil
            transition(.failed(error.localizedDescription))
        }
    }

    /// Feed audio from the agent's existing microphone tap.
    ///
    /// Takes samples rather than an `AVAudioPCMBuffer` because that class is
    /// not `Sendable`: handing one across the actor boundary would be a real
    /// race, not a compiler technicality — the audio thread reuses its buffers.
    /// The caller copies on the audio thread, which is a memcpy, and this
    /// rebuilds a buffer on the far side.
    public func accept(samples: [Float], sampleRate: Double) async {
        guard state == .listening, let manager else { return }
        guard
            let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1,
                interleaved: false),
            let buffer = AVAudioPCMBuffer(
                pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))
        else { return }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { src in
            buffer.floatChannelData![0].update(from: src.baseAddress!, count: samples.count)
        }
        await manager.streamAudio(buffer)
    }

    private func handle(_ update: SlidingWindowTranscriptionUpdate) {
        // Volatile updates are the decoder thinking out loud. Only what it has
        // committed to gets typed.
        guard update.isConfirmed else { return }
        let phrase = DictationSpacing.prepare(
            update.text, precededBy: injectedSoFar.isEmpty ? nil : injectedSoFar)
        guard !phrase.isEmpty else { return }
        injectedSoFar += phrase
        onPhrase?(phrase)
    }

    /// Stop, flushing whatever the decoder was still holding.
    @discardableResult
    public func stop() async -> String {
        pump?.cancel()
        pump = nil

        var tail = ""
        if let manager {
            // finish() returns the full session text; the part not yet injected
            // is what the user is still owed.
            let complete = (try? await manager.finish()) ?? ""
            await manager.cleanup()
            let injectedTrimmed = injectedSoFar.trimmingCharacters(in: .whitespaces)
            if complete.count > injectedTrimmed.count, complete.hasPrefix(injectedTrimmed) {
                tail = String(complete.dropFirst(injectedTrimmed.count))
                    .trimmingCharacters(in: .whitespaces)
            }
        }
        manager = nil
        transition(.idle)

        let prepared = DictationSpacing.prepare(
            tail, precededBy: injectedSoFar.isEmpty ? nil : injectedSoFar)
        injectedSoFar = ""
        if !prepared.isEmpty { onPhrase?(prepared) }
        return prepared
    }
}
