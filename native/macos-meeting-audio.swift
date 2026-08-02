// Captures a meeting: the microphone ("me") and system audio ("them"), on two
// separate channels, written straight to disk as AAC.
//
// This is a dumb pipe with no UI, no window, no menu bar and no state of its
// own. Electron owns the session; this process is spawned when a recording
// starts and told to stop by closing its stdin.
//
// It writes the files itself rather than streaming PCM to Node. A meeting runs
// an hour, nothing inspects the audio mid-flight, and an unrepeatable recording
// should not depend on a renderer surviving that long without being throttled
// or suspended.
//
// Protocol
//   argv:    --mic <path> --system <path> [--sample-rate N]
//   stdout:  one JSON object per line
//              {"type":"ready"}
//              {"type":"level","mic":0.12,"system":0.04}     ~10/s
//              {"type":"done","seconds":812.4,"systemBytes":N}
//   stderr:  {"type":"error","code":"...","message":"..."}
//   stdin:   closes -> stop, flush, emit done, exit 0
//
// Permissions: microphone (TCC prompt on first engine start) and Screen
// Recording (required by ScreenCaptureKit even for audio-only). Both attach to
// the *parent* — Noteato.app — because this is a bare executable rather than a
// bundle, which is the intended behaviour: one app, one identity, one prompt.

import AVFoundation
import CoreGraphics
import Foundation
import ScreenCaptureKit

// MARK: - Line protocol

let stdoutQueue = DispatchQueue(label: "com.noteato.meeting-audio.stdout")

func emit(_ object: [String: Any], to handle: FileHandle = .standardOutput) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    stdoutQueue.sync {
        handle.write(line.data(using: .utf8)!)
    }
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["type": "error", "code": code, "message": message], to: .standardError)
    exit(1)
}

// MARK: - Arguments

struct Options {
    var micPath: String
    var systemPath: String
    var sampleRate: Double
}

func parseOptions() -> Options {
    var mic: String?
    var system: String?
    var sampleRate = 48_000.0

    var args = Array(CommandLine.arguments.dropFirst())
    while !args.isEmpty {
        let flag = args.removeFirst()
        switch flag {
        case "--mic":
            guard !args.isEmpty else { fail("bad_arguments", "--mic needs a path") }
            mic = args.removeFirst()
        case "--system":
            guard !args.isEmpty else { fail("bad_arguments", "--system needs a path") }
            system = args.removeFirst()
        case "--sample-rate":
            guard !args.isEmpty, let value = Double(args.removeFirst()) else {
                fail("bad_arguments", "--sample-rate needs a number")
            }
            sampleRate = value
        default:
            fail("bad_arguments", "unknown flag \(flag)")
        }
    }

    guard let mic, let system else {
        fail("bad_arguments", "--mic and --system are both required")
    }
    return Options(micPath: mic, systemPath: system, sampleRate: sampleRate)
}

// MARK: - AAC writer

/// Serialised AAC-in-m4a writer. `AVAudioFile` is not thread-safe and the two
/// capture paths deliver on different queues, so every write funnels through one.
final class ChannelWriter {
    private let queue: DispatchQueue
    private var file: AVAudioFile?
    private var converter: AVAudioConverter?
    private let outputURL: URL
    private let sampleRate: Double
    private(set) var frames: AVAudioFramePosition = 0

    /// Peak of the most recent buffer, for the recording pill's level meter.
    private var levelValue: Float = 0
    var level: Float { queue.sync { levelValue } }

    init(url: URL, sampleRate: Double, label: String) {
        self.outputURL = url
        self.sampleRate = sampleRate
        self.queue = DispatchQueue(label: "com.noteato.meeting-audio.\(label)")
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        queue.async { [self] in
            guard let mono = downmix(buffer) else { return }
            levelValue = peak(of: mono)

            do {
                if file == nil { try openFile(matching: mono.format) }
                try file?.write(from: mono)
                frames += AVAudioFramePosition(mono.frameLength)
            } catch {
                emit(
                    ["type": "error", "code": "write_failed", "message": "\(error)"],
                    to: .standardError
                )
            }
        }
    }

    /// Closing the file is what writes the m4a moov atom. Without this the file
    /// on disk is unplayable — which for a meeting is total data loss.
    func finish() {
        queue.sync { file = nil }
    }

    var seconds: Double { Double(frames) / sampleRate }
    var wroteAnything: Bool { queue.sync { frames > 0 } }

    private func openFile(matching format: AVAudioFormat) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000
        ]
        file = try AVAudioFile(forWriting: outputURL, settings: settings)
    }

    /// One channel is all the transcriber wants, and halves what a meeting costs
    /// on disk. System audio arrives stereo; the mic may too.
    private func downmix(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let channels = buffer.floatChannelData else { return nil }
        if buffer.format.channelCount == 1 { return buffer }

        guard
            let monoFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: buffer.format.sampleRate,
                channels: 1,
                interleaved: false
            ),
            let mono = AVAudioPCMBuffer(
                pcmFormat: monoFormat,
                frameCapacity: buffer.frameLength
            ),
            let out = mono.floatChannelData?[0]
        else { return nil }

        let count = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        let scale = 1.0 / Float(channelCount)
        for frame in 0..<count {
            var sum: Float = 0
            for channel in 0..<channelCount { sum += channels[channel][frame] }
            out[frame] = sum * scale
        }
        mono.frameLength = buffer.frameLength
        return mono
    }

    private func peak(of buffer: AVAudioPCMBuffer) -> Float {
        guard let samples = buffer.floatChannelData?[0] else { return 0 }
        var maximum: Float = 0
        for index in 0..<Int(buffer.frameLength) {
            maximum = max(maximum, abs(samples[index]))
        }
        return maximum
    }
}

// MARK: - System audio

/// ScreenCaptureKit audio-only tap.
///
/// A display filter is mandatory even when only audio is wanted, so the stream
/// is configured at 2x2 and 1fps and the video frames are dropped untouched —
/// that is the cheapest legal shape for an audio-only SCStream.
@available(macOS 13.0, *)
final class SystemAudioCapture: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private let writer: ChannelWriter

    init(writer: ChannelWriter) {
        self.writer = writer
    }

    static var hasPermission: Bool {
        // Silent — CGRequestScreenCaptureAccess would prompt, and a recording
        // that has already started is the wrong moment to be asking.
        CGPreflightScreenCaptureAccess()
    }

    func start(sampleRate: Double) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: false
        )
        guard let display = content.displays.first else {
            throw NSError(
                domain: "noteato", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "no display available to attach an audio tap to"]
            )
        }

        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.sampleRate = Int(sampleRate)
        configuration.channelCount = 2
        // Noteato's own output must not feed back into "them".
        configuration.excludesCurrentProcessAudio = true
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.showsCursor = false

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        try stream.addStreamOutput(
            self,
            type: .audio,
            sampleHandlerQueue: DispatchQueue(label: "com.noteato.meeting-audio.sc")
        )
        try await stream.startCapture()
        self.stream = stream
    }

    func stop() async {
        guard let stream else { return }
        self.stream = nil
        try? await stream.stopCapture()
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, sampleBuffer.isValid else { return }
        guard let buffer = pcmBuffer(from: sampleBuffer) else { return }
        writer.append(buffer)
    }

    private func pcmBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard
            let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
            let streamDescription =
                CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)
        else { return nil }

        var format = streamDescription.pointee
        guard let avFormat = AVAudioFormat(streamDescription: &format) else { return nil }

        let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
        guard frames > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: avFormat, frameCapacity: frames)
        else { return nil }
        buffer.frameLength = frames

        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer,
            at: 0,
            frameCount: Int32(frames),
            into: buffer.mutableAudioBufferList
        )
        return status == noErr ? buffer : nil
    }
}

// MARK: - Main

let options = parseOptions()

guard #available(macOS 13.0, *) else {
    fail("unsupported_os", "meeting capture needs macOS 13 or later")
}

guard SystemAudioCapture.hasPermission else {
    fail(
        "screen_recording_denied",
        "Screen Recording permission is required to capture system audio"
    )
}

let micWriter = ChannelWriter(
    url: URL(fileURLWithPath: options.micPath),
    sampleRate: options.sampleRate,
    label: "mic"
)
let systemWriter = ChannelWriter(
    url: URL(fileURLWithPath: options.systemPath),
    sampleRate: options.sampleRate,
    label: "system"
)

// Microphone.
let engine = AVAudioEngine()
let input = engine.inputNode
let inputFormat = input.outputFormat(forBus: 0)
guard inputFormat.sampleRate > 0 else {
    fail("no_microphone", "no usable audio input device")
}
input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, _ in
    micWriter.append(buffer)
}

do {
    try engine.start()
} catch {
    fail("microphone_failed", "\(error)")
}

// System audio.
let systemCapture = SystemAudioCapture(writer: systemWriter)
let startupGroup = DispatchGroup()
startupGroup.enter()
var systemStartError: Error?
Task {
    do {
        try await systemCapture.start(sampleRate: options.sampleRate)
    } catch {
        systemStartError = error
    }
    startupGroup.leave()
}
startupGroup.wait()

if let systemStartError {
    engine.stop()
    fail("system_audio_failed", "\(systemStartError)")
}

emit(["type": "ready"])

// Level updates for the pill.
let levelTimer = DispatchSource.makeTimerSource(queue: stdoutQueue)
levelTimer.schedule(deadline: .now() + 0.1, repeating: 0.1)
levelTimer.setEventHandler {
    emit([
        "type": "level",
        "mic": Double(micWriter.level),
        "system": Double(systemWriter.level)
    ])
}
levelTimer.resume()

func shutDown() -> Never {
    levelTimer.cancel()
    engine.stop()
    input.removeTap(onBus: 0)

    let group = DispatchGroup()
    group.enter()
    Task {
        await systemCapture.stop()
        group.leave()
    }
    group.wait()

    // Order matters: finish() closes each file and writes its moov atom.
    micWriter.finish()
    systemWriter.finish()

    emit([
        "type": "done",
        "seconds": micWriter.seconds,
        "systemCaptured": systemWriter.wroteAnything
    ])
    exit(0)
}

// Electron stops the recording by closing our stdin. Signals are handled too so
// a terminated helper still closes its files rather than leaving them unplayable.
for signalNumber in [SIGTERM, SIGINT] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler { shutDown() }
    source.resume()
    // Kept alive for the process lifetime by design.
    _ = Unmanaged.passRetained(source)
}

let stdinSource = DispatchSource.makeReadSource(
    fileDescriptor: FileHandle.standardInput.fileDescriptor,
    queue: .main
)
stdinSource.setEventHandler {
    var byte: UInt8 = 0
    if read(FileHandle.standardInput.fileDescriptor, &byte, 1) <= 0 { shutDown() }
}
stdinSource.resume()

dispatchMain()
