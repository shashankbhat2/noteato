import AVFoundation
import Foundation

/// Owns the microphone and the pre-roll buffer.
///
/// The mic stream stays open while listening, which is the only way capture can
/// begin in the past. That is a serious thing to do to someone's computer, so
/// the design commits to three things and the UI is built on top of them:
///
/// - The buffer is cleared on pause, on stop, and on every commit.
/// - Nothing is ever written to disk except a capture the user committed.
/// - `state` is always the truth about the microphone, so the menu bar can
///   never say "paused" while the stream is live.
public final class MicCapture: @unchecked Sendable {
    public enum State: Equatable, Sendable {
        /// Mic closed. Either the user paused, or pre-roll is set to 0.
        case idle
        /// Mic open, filling the pre-roll buffer. Nothing is being kept.
        case listening
        /// A capture is in progress; audio is being accumulated for a commit.
        case recording
    }

    /// Everything here is touched from both the audio thread and the main
    /// thread, so all mutable state lives behind this lock.
    private let lock = NSLock()
    private let engine = AVAudioEngine()
    private var buffer: PreRollBuffer
    private var captured: [Float] = []
    private var isRecording = false
    private var running = false
    private var level: Float = 0

    /// Fallback only, for sizing before a device has been opened. The real
    /// rate comes from the input device — see `sampleRate`.
    public static let defaultSampleRate: Double = 48_000

    /// The rate the buffer and any committed file actually use: whatever the
    /// input device runs at.
    ///
    /// Deliberately not resampled to a fixed rate. A buffer sized for 48 kHz
    /// but fed 44.1 kHz audio holds the wrong number of seconds, and a file
    /// written with the wrong rate in its header plays back at the wrong
    /// speed — a bug that only shows up on hardware nobody tested on.
    public private(set) var sampleRate: Double = MicCapture.defaultSampleRate

    /// 0 disables pre-roll: the mic is not opened at all. That is the setting's
    /// whole point, so it must close the stream rather than buffer-and-discard.
    public private(set) var preRollSeconds: Double

    public var onStateChange: (@Sendable (State) -> Void)?

    public init(preRollSeconds: Double = 10) {
        self.preRollSeconds = preRollSeconds
        self.buffer = PreRollBuffer(
            seconds: max(preRollSeconds, 0.1), sampleRate: MicCapture.defaultSampleRate)
    }

    public var state: State {
        lock.lock()
        defer { lock.unlock() }
        if isRecording { return .recording }
        return running ? .listening : .idle
    }

    /// Most recent input level, 0…1, for the HUD waveform.
    public var currentLevel: Float {
        lock.lock()
        defer { lock.unlock() }
        return level
    }

    // MARK: - Listening

    /// Open the mic and start filling the pre-roll buffer.
    ///
    /// Returns false when pre-roll is disabled or the engine refused to start;
    /// callers must reflect that in the UI rather than assume success, because
    /// a menu bar that claims to be listening when it is not is the single
    /// worst failure this feature can have.
    @discardableResult
    public func startListening() -> Bool {
        lock.lock()
        if running || preRollSeconds <= 0 {
            lock.unlock()
            return false
        }
        lock.unlock()

        let input = engine.inputNode
        let hardwareFormat = input.outputFormat(forBus: 0)
        guard hardwareFormat.sampleRate > 0 else { return false }

        // Size the buffer to the device that is actually open, so "10 seconds"
        // means ten seconds regardless of what it runs at.
        lock.lock()
        if hardwareFormat.sampleRate != sampleRate {
            sampleRate = hardwareFormat.sampleRate
            buffer = PreRollBuffer(seconds: max(preRollSeconds, 0.1), sampleRate: sampleRate)
        }
        lock.unlock()

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: hardwareFormat) {
            [weak self] pcm, _ in
            self?.consume(pcm)
        }

        do {
            engine.prepare()
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            return false
        }

        lock.lock()
        running = true
        lock.unlock()
        onStateChange?(.listening)
        return true
    }

    /// Close the mic and forget everything buffered.
    public func stopListening() {
        lock.lock()
        let wasRunning = running
        lock.unlock()
        guard wasRunning else { return }

        engine.inputNode.removeTap(onBus: 0)
        engine.stop()

        lock.lock()
        running = false
        isRecording = false
        captured.removeAll()
        buffer.reset()
        level = 0
        lock.unlock()
        onStateChange?(.idle)
    }

    /// Change the pre-roll length, opening or closing the mic to match.
    public func setPreRollSeconds(_ seconds: Double) {
        let clamped = min(max(seconds, 0), 15)
        let wasRunning = state != .idle
        stopListening()

        lock.lock()
        preRollSeconds = clamped
        buffer = PreRollBuffer(seconds: max(clamped, 0.1), sampleRate: sampleRate)
        lock.unlock()

        if wasRunning && clamped > 0 { startListening() }
    }

    // MARK: - Capture

    /// Begin a capture. The pre-roll already in the buffer becomes its opening.
    public func beginCapture() {
        lock.lock()
        // Seeding `captured` with the buffer is the whole feature: the file
        // starts before the keypress that asked for it.
        captured = buffer.snapshot()
        isRecording = true
        lock.unlock()
        onStateChange?(.recording)
    }

    /// End a capture and hand back everything recorded, pre-roll included.
    ///
    /// The buffer is cleared either way: a committed capture has been kept, and
    /// a discarded one was never meant to be.
    public func endCapture(keep: Bool) -> [Float] {
        lock.lock()
        let samples = keep ? captured : []
        captured.removeAll()
        isRecording = false
        buffer.reset()
        let stillRunning = running
        lock.unlock()

        onStateChange?(stillRunning ? .listening : .idle)
        return samples
    }

    /// Seconds of pre-roll currently available — less than the configured
    /// length until the mic has been open that long.
    public var bufferedSeconds: Double {
        lock.lock()
        defer { lock.unlock() }
        return buffer.availableSeconds
    }

    // MARK: - Audio thread

    private func consume(_ pcm: AVAudioPCMBuffer) {
        guard let channels = pcm.floatChannelData, pcm.frameLength > 0 else { return }
        let frames = Int(pcm.frameLength)
        // First channel only. Speech capture is mono, and mixing channels on
        // the audio thread would cost an allocation per tap for no gain.
        let mono = UnsafeBufferPointer(start: channels[0], count: frames)

        // Peak rather than RMS: the waveform should react to a word starting,
        // and RMS over a 4096-frame window smooths exactly that away.
        var peak: Float = 0
        for sample in mono { peak = max(peak, abs(sample)) }

        lock.lock()
        // Smoothed toward the peak so the HUD decays rather than flickering.
        level = max(peak, level * 0.82)
        if isRecording {
            captured.append(contentsOf: mono)
        }
        buffer.write(mono)
        lock.unlock()
    }
}
