// Captures a meeting as one playable AAC file. Microphone ("me") and system
// audio ("them") are written to hidden working tracks during capture so they
// can still be transcribed separately, then mixed into the user-facing file.
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
//   argv:    --mic <temp-path> --system <temp-path> --output <path>
//            [--sample-rate N]
//            --append <existing-m4a> <new-m4a> <output-m4a>
//   stdout:  one JSON object per line
//              {"type":"ready"}
//              {"type":"level","mic":0.12,"system":0.04}     ~10/s
//              {"type":"done","seconds":812.4,"systemBytes":N}
//   stderr:  {"type":"error","code":"...","message":"..."}
//   stdin:   closes -> stop, flush, emit done, exit 0
//
// Permissions: microphone and Screen Recording (required by ScreenCaptureKit
// even for audio-only). Both are requested explicitly before their capture
// path starts. If Screen Recording stays unavailable, microphone capture still
// proceeds — losing the whole meeting is not an acceptable permission UX.

import AVFoundation
import CoreGraphics
import Foundation
import ScreenCaptureKit

// MARK: - Line protocol

/// Serialises writes so two threads cannot interleave halves of a line.
///
/// Every caller must reach this through `emit`, and nothing may run *on* this
/// queue: `emit` uses `sync`, and dispatching sync onto the queue you are
/// already executing on is a deterministic trap, not a deadlock you might get
/// away with. An earlier version scheduled the level timer here and died on its
/// first tick.
private let stdoutQueue = DispatchQueue(label: "com.noteato.meeting-audio.stdout")

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
    var outputPath: String
    var sampleRate: Double
}

func parseOptions() -> Options {
    var mic: String?
    var system: String?
    var output: String?
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
        case "--output":
            guard !args.isEmpty else { fail("bad_arguments", "--output needs a path") }
            output = args.removeFirst()
        case "--sample-rate":
            guard !args.isEmpty, let value = Double(args.removeFirst()) else {
                fail("bad_arguments", "--sample-rate needs a number")
            }
            sampleRate = value
        default:
            fail("bad_arguments", "unknown flag \(flag)")
        }
    }

    guard let mic, let system, let output else {
        fail("bad_arguments", "--mic, --system and --output are all required")
    }
    return Options(
        micPath: mic,
        systemPath: system,
        outputPath: output,
        sampleRate: sampleRate
    )
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

// MARK: - Final mix

/// Mix the two capture tracks without ever holding the whole meeting in memory.
/// The working files decode to mono Float32, so an 8192-frame buffer is enough
/// no matter how long the recording runs.
func mixCapture(micPath: String, systemPath: String, outputPath: String) throws {
    let fileManager = FileManager.default
    let micFile = try AVAudioFile(forReading: URL(fileURLWithPath: micPath))
    let format = micFile.processingFormat
    guard format.channelCount == 1 else {
        throw NSError(
            domain: "noteato", code: 3,
            userInfo: [NSLocalizedDescriptionKey: "microphone working track is not mono"]
        )
    }

    let systemFile: AVAudioFile?
    if fileManager.fileExists(atPath: systemPath) {
        let candidate = try AVAudioFile(forReading: URL(fileURLWithPath: systemPath))
        guard candidate.processingFormat.channelCount == 1,
              candidate.processingFormat.sampleRate == format.sampleRate else {
            throw NSError(
                domain: "noteato", code: 4,
                userInfo: [NSLocalizedDescriptionKey: "capture tracks use incompatible formats"]
            )
        }
        systemFile = candidate
    } else {
        systemFile = nil
    }

    if fileManager.fileExists(atPath: outputPath) {
        try fileManager.removeItem(atPath: outputPath)
    }
    let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: format.sampleRate,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 96_000
    ]
    let outputFile = try AVAudioFile(
        forWriting: URL(fileURLWithPath: outputPath),
        settings: settings
    )

    let capacity: AVAudioFrameCount = 8192
    guard let micBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity),
          let systemBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity),
          let mixedBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity),
          let micSamples = micBuffer.floatChannelData?[0],
          let systemSamples = systemBuffer.floatChannelData?[0],
          let mixedSamples = mixedBuffer.floatChannelData?[0]
    else {
        throw NSError(
            domain: "noteato", code: 5,
            userInfo: [NSLocalizedDescriptionKey: "could not allocate audio mix buffers"]
        )
    }

    while true {
        micBuffer.frameLength = 0
        systemBuffer.frameLength = 0
        try micFile.read(into: micBuffer, frameCount: capacity)
        if let systemFile {
            try systemFile.read(into: systemBuffer, frameCount: capacity)
        }

        let frames = max(micBuffer.frameLength, systemBuffer.frameLength)
        if frames == 0 { break }
        mixedBuffer.frameLength = frames
        for frame in 0..<Int(frames) {
            let mic = frame < Int(micBuffer.frameLength) ? micSamples[frame] : 0
            let system = frame < Int(systemBuffer.frameLength) ? systemSamples[frame] : 0
            mixedSamples[frame] = max(-1, min(1, mic + system))
        }
        try outputFile.write(from: mixedBuffer)
    }
}

/// Concatenate completed mixed captures into a fresh file. The writer reuses
/// the complete file format AVFoundation already decoded, and each input gets
/// a buffer made from its own processing format. Reads are bounded by the known
/// frame length because asking AVAudioFile for one buffer past AAC EOF can throw
/// instead of returning an empty buffer.
///
/// The caller writes to a temporary destination and atomically swaps it into
/// place, so a failed append can never damage the recording the user had.
func appendCapture(existingPath: String, newPath: String, outputPath: String) throws {
    let existing: AVAudioFile
    let addition: AVAudioFile
    do {
        existing = try AVAudioFile(forReading: URL(fileURLWithPath: existingPath))
    } catch {
        throw NSError(
            domain: "noteato", code: 10,
            userInfo: [NSLocalizedDescriptionKey: "could not open existing recording: \(error)"]
        )
    }
    do {
        addition = try AVAudioFile(forReading: URL(fileURLWithPath: newPath))
    } catch {
        throw NSError(
            domain: "noteato", code: 11,
            userInfo: [NSLocalizedDescriptionKey: "could not open new recording: \(error)"]
        )
    }
    let format = existing.processingFormat
    guard addition.processingFormat.channelCount == format.channelCount,
          addition.processingFormat.sampleRate == format.sampleRate else {
        throw NSError(
            domain: "noteato", code: 6,
            userInfo: [NSLocalizedDescriptionKey: "recordings use incompatible audio formats"]
        )
    }

    let fileManager = FileManager.default
    if fileManager.fileExists(atPath: outputPath) {
        try fileManager.removeItem(atPath: outputPath)
    }
    // Reuse the complete file format AVFoundation successfully decoded instead
    // of reconstructing a partial set of AAC encoder settings by hand.
    let settings = existing.fileFormat.settings
    let output: AVAudioFile
    do {
        output = try AVAudioFile(
            forWriting: URL(fileURLWithPath: outputPath),
            settings: settings
        )
    } catch {
        throw NSError(
            domain: "noteato", code: 12,
            userInfo: [NSLocalizedDescriptionKey: "could not create appended recording: \(error)"]
        )
    }
    let capacity: AVAudioFrameCount = 8192

    for (index, input) in [existing, addition].enumerated() {
        // AVAudioFile's decoder requires a buffer made from that file's exact
        // processing format object. Two formats can report the same rate and
        // channel count yet still differ in stream-description flags.
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: input.processingFormat,
            frameCapacity: capacity
        ) else {
            throw NSError(
                domain: "noteato", code: 7,
                userInfo: [NSLocalizedDescriptionKey: "could not allocate audio append buffer"]
            )
        }
        while input.framePosition < input.length {
            buffer.frameLength = 0
            let remaining = AVAudioFrameCount(input.length - input.framePosition)
            do {
                try input.read(into: buffer, frameCount: min(capacity, remaining))
            } catch {
                throw NSError(
                    domain: "noteato", code: 8,
                    userInfo: [
                        NSLocalizedDescriptionKey: "could not decode append input \(index + 1): \(error)"
                    ]
                )
            }
            if buffer.frameLength == 0 { break }
            do {
                try output.write(from: buffer)
            } catch {
                throw NSError(
                    domain: "noteato", code: 9,
                    userInfo: [
                        NSLocalizedDescriptionKey: "could not encode append input \(index + 1): \(error)"
                    ]
                )
            }
        }
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

    static func requestPermission() -> Bool {
        if CGPreflightScreenCaptureAccess() { return true }
        // Preflight alone never presents the system consent sheet. Requesting
        // here makes the first recording a complete permission flow instead of
        // an endless trip to System Settings.
        return CGRequestScreenCaptureAccess()
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

// File-only append mode deliberately exits before any permission checks or
// capture setup. It is also useful in packaged builds because it uses the same
// signed AVFoundation helper already shipped for recording.
let rawArguments = Array(CommandLine.arguments.dropFirst())
if rawArguments.first == "--append" {
    guard rawArguments.count == 4 else {
        fail("bad_arguments", "--append needs existing, new and output paths")
    }
    do {
        try appendCapture(
            existingPath: rawArguments[1],
            newPath: rawArguments[2],
            outputPath: rawArguments[3]
        )
        emit(["type": "appended"])
        exit(0)
    } catch {
        fail("write_failed", "could not append recording: \(error)")
    }
}

let options = parseOptions()

guard #available(macOS 13.0, *) else {
    fail("unsupported_os", "meeting capture needs macOS 13 or later")
}

// Ask for microphone access explicitly. Relying on AVAudioEngine.start() to do
// this made a denial indistinguishable from a missing or broken input device.
func requestMicrophonePermission() -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        return true
    case .denied, .restricted:
        return false
    case .notDetermined:
        let semaphore = DispatchSemaphore(value: 0)
        var granted = false
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            granted = allowed
            semaphore.signal()
        }
        semaphore.wait()
        return granted
    @unknown default:
        return false
    }
}

guard requestMicrophonePermission() else {
    fail("microphone_denied", "Microphone permission was not granted")
}

let captureSystemAudio = SystemAudioCapture.requestPermission()
if !captureSystemAudio {
    emit(
        [
            "type": "warning",
            "code": "screen_recording_denied",
            "message": "Recording microphone only. Grant Screen Recording access to include system audio."
        ],
        to: .standardError
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

// System audio. Permission or startup failure degrades to microphone-only
// capture rather than cancelling an otherwise valid meeting recording.
let systemCapture = SystemAudioCapture(writer: systemWriter)
if captureSystemAudio {
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
        emit(
            [
                "type": "warning",
                "code": "system_audio_failed",
                "message": "Recording microphone only because system audio could not start: \(systemStartError)"
            ],
            to: .standardError
        )
    }
}

emit(["type": "ready"])

// Level updates for the pill. This must not run on stdoutQueue: emit() enters
// that queue synchronously to keep each protocol line atomic.
let levelTimer = DispatchSource.makeTimerSource(
    queue: DispatchQueue(label: "com.noteato.meeting-audio.levels")
)
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

    // Keep the speaker-separated files for transcription, but expose only one
    // recording to the user. If mixing itself fails, preserve the irreplaceable
    // mic track as the playable recording instead of failing the whole session.
    do {
        try mixCapture(
            micPath: options.micPath,
            systemPath: options.systemPath,
            outputPath: options.outputPath
        )
    } catch {
        do {
            let fileManager = FileManager.default
            if fileManager.fileExists(atPath: options.outputPath) {
                try fileManager.removeItem(atPath: options.outputPath)
            }
            try fileManager.copyItem(atPath: options.micPath, toPath: options.outputPath)
            FileHandle.standardError.write(
                "meeting audio mix failed; kept microphone audio: \(error)\n"
                    .data(using: .utf8)!
            )
        } catch {
            fail("write_failed", "could not create the final recording: \(error)")
        }
    }

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
