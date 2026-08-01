import AVFoundation
@preconcurrency import ScreenCaptureKit

/// System audio — everything the *other* people on a call are saying.
///
/// Paired with `MicCapture` this gives two-way attribution that is exact by
/// construction: the microphone is you, system audio is them. No speaker
/// embeddings, no clustering, no threshold to tune, and no way for it to be
/// subtly wrong on a voice it has not heard before.
///
/// That is deliberate, not a shortcut. §8 rules out N-speaker diarization
/// because it "is where every competitor gets criticized" — and FluidAudio
/// ships a perfectly good diarizer we are choosing not to use. A guarantee
/// beats a good model here, and speaker embeddings are a different privacy
/// conversation on a product whose central claim is that nothing leaves the
/// machine.
///
/// Nothing joins the call and no bot appears in the participant list: this is
/// the OS handing us the audio it is already playing.
public final class SystemAudioCapture: NSObject, @unchecked Sendable {
    public enum CaptureError: Error, LocalizedError {
        case permissionDenied
        case noDisplay
        case failedToStart(String)

        public var errorDescription: String? {
            switch self {
            case .permissionDenied:
                return
                    "Screen Recording permission is needed to hear the other side of a call. macOS puts system audio behind that permission even though Noteato never records the screen."
            case .noDisplay: return "No display was available to capture audio from."
            case .failedToStart(let detail): return "System audio could not start: \(detail)"
            }
        }
    }

    private let lock = NSLock()
    private var stream: SCStream?
    private var samples: [Float] = []
    private var recording = false
    private(set) public var sampleRate: Double = 48_000

    public override init() { super.init() }

    /// Whether Screen Recording has been granted, without prompting.
    ///
    /// `CGPreflightScreenCaptureAccess` is the only way to ask that does not
    /// pop a dialog — worth having, because §8 says a meeting prompt appears
    /// only after explicit opt-in, and we cannot honour that if merely checking
    /// causes a prompt.
    public static var hasPermission: Bool {
        CGPreflightScreenCaptureAccess()
    }

    @discardableResult
    public static func requestPermission() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    public var isRecording: Bool {
        lock.lock()
        defer { lock.unlock() }
        return recording
    }

    /// Start capturing system audio. Audio only — no frames are ever decoded.
    public func start() async throws {
        guard SystemAudioCapture.hasPermission else { throw CaptureError.permissionDenied }

        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw CaptureError.noDisplay }

        // A display filter is required even for audio-only capture, so this
        // asks for the smallest possible video alongside it and never looks at
        // a frame. Noteato does not record anyone's screen.
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = Int(sampleRate)
        config.channelCount = 1
        // Our own output would otherwise be captured and transcribed back,
        // which on a call means hearing yourself twice.
        config.excludesCurrentProcessAudio = true
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global(qos: .userInitiated))

        do {
            try await stream.startCapture()
        } catch {
            throw CaptureError.failedToStart(error.localizedDescription)
        }

        markStarted(stream)
    }

    /// NSLock is unavailable from an async context, so every critical section
    /// stays in a synchronous helper rather than spanning a suspension point.
    private func markStarted(_ stream: SCStream) {
        lock.lock()
        defer { lock.unlock() }
        self.stream = stream
        samples.removeAll()
        recording = true
    }

    private func takeAll() -> (SCStream?, [Float]) {
        lock.lock()
        defer { lock.unlock() }
        let active = stream
        stream = nil
        recording = false
        let captured = samples
        samples.removeAll()
        return (active, captured)
    }

    /// Stop and return everything heard, discarding it from memory.
    @discardableResult
    public func stop() async -> [Float] {
        let (active, captured) = takeAll()
        if let active { try? await active.stopCapture() }
        return captured
    }

    public var capturedSeconds: Double {
        lock.lock()
        defer { lock.unlock() }
        return Double(samples.count) / sampleRate
    }
}

extension SystemAudioCapture: SCStreamOutput {
    public func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        // Video frames are requested only because the API insists on a filter;
        // they are dropped here without ever being touched.
        guard type == .audio, sampleBuffer.isValid else { return }
        try? sampleBuffer.withAudioBufferList { list, _ in
            for buffer in list {
                guard let data = buffer.mData else { continue }
                let count = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
                let incoming = UnsafeBufferPointer(
                    start: data.assumingMemoryBound(to: Float.self), count: count)
                append(incoming)
                // First channel only; the config asks for mono anyway.
                break
            }
        }
    }

    private func append(_ incoming: UnsafeBufferPointer<Float>) {
        lock.lock()
        defer { lock.unlock() }
        if recording { samples.append(contentsOf: incoming) }
    }
}
