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
    /// Audio arrives on the capture thread and must reach the decoder in the
    /// order it was spoken. An unstructured `Task` per buffer does not promise
    /// that — they race, and the sliding window reassembles scrambled audio
    /// into confident nonsense. A single stream with one consumer is what makes
    /// the ordering a property of the design rather than a hope.
    private var feed: AsyncStream<[Float]>.Continuation?
    private var feeder: Task<Void, Never>?
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

            let (stream, continuation) = AsyncStream<[Float]>.makeStream(
                bufferingPolicy: .bufferingNewest(64))
            feed = continuation
            let rate = captureSampleRate
            feeder = Task {
                for await samples in stream {
                    guard !Task.isCancelled else { return }
                    guard
                        let format = AVAudioFormat(
                            commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1,
                            interleaved: false),
                        let buffer = AVAudioPCMBuffer(
                            pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))
                    else { continue }
                    buffer.frameLength = AVAudioFrameCount(samples.count)
                    samples.withUnsafeBufferPointer { src in
                        buffer.floatChannelData![0].update(
                            from: src.baseAddress!, count: samples.count)
                    }
                    await asr.streamAudio(buffer)
                }
            }

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

    /// The rate the microphone is running at. Set before `start()`; the feeder
    /// captures it once rather than trusting each buffer to carry it.
    private var captureSampleRate: Double = 48_000

    public func setSampleRate(_ rate: Double) {
        captureSampleRate = rate
    }

    /// Hand audio to the decoder, in order.
    ///
    /// Takes samples rather than an `AVAudioPCMBuffer` because that class is
    /// not `Sendable` and the audio thread reuses its buffers — a real race,
    /// not a compiler technicality. Yielding to a stream is non-blocking, so
    /// this is safe to call from the capture callback.
    public nonisolated func accept(samples: [Float]) {
        Task { await self.enqueue(samples) }
    }

    private func enqueue(_ samples: [Float]) {
        feed?.yield(samples)
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
        feed?.finish()
        feed = nil
        // Let the feeder drain what it still holds before finish() is asked
        // for the total — otherwise the tail is computed against audio the
        // decoder has not seen yet.
        await feeder?.value
        feeder = nil
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
