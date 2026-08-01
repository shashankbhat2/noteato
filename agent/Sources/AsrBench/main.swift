// §6 gate: on-device transcription, measured on *this* machine.
//
//   swift run -c release AsrBench [--file <audio>] [--json]
//
// FluidAudio advertises ~190x realtime on an M4 Pro. That is a number from
// someone else's hardware on someone else's audio, and the revamp brief is
// explicit that the engine is picked on latency-per-accuracy rather than on a
// claim. This measures what actually happens here:
//
//   - model download size and cold load time (first run pays it, and §9 wants
//     the app usable offline afterwards)
//   - realtime factor against the < 0.3x budget
//   - peak resident memory, against the agent's 150 MB cap — the reason
//     "idle" has to mean the model is unloaded
//
// With no --file it synthesises a tone, which measures the pipeline but says
// nothing about accuracy. Pass real speech to judge that.
import AVFoundation
import AgentCore
import FluidAudio
import Foundation

let argv = CommandLine.arguments
func flag(_ name: String) -> String? {
    guard let i = argv.firstIndex(of: "--\(name)"), i + 1 < argv.count else { return nil }
    return argv[i + 1]
}
let asJSON = argv.contains("--json")

func residentMB() -> Double {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(
        MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
    let kerr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
    }
    return kerr == KERN_SUCCESS ? Double(info.resident_size) / 1_048_576.0 : 0
}

func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

/// Directory size on disk, for the model download the DMG deliberately omits.
func directorySizeMB(_ url: URL) -> Double {
    guard
        let e = FileManager.default.enumerator(
            at: url, includingPropertiesForKeys: [.fileSizeKey])
    else { return 0 }
    var total = 0
    for case let f as URL in e {
        total += (try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    }
    return round2(Double(total) / 1_048_576.0)
}

/// Fallback audio when no file is given: enough to exercise the pipeline.
func syntheticSpeechLike(seconds: Double, sampleRate: Double) -> [Float] {
    let count = Int(seconds * sampleRate)
    return (0..<count).map { i in
        let t = Double(i) / sampleRate
        // A couple of formant-ish tones with an envelope, so it is not a pure
        // sine the encoder can trivially collapse.
        let envelope = 0.5 * (1 - cos(2 * .pi * min(t / seconds, 1)))
        return Float(envelope * (0.4 * sin(2 * .pi * 220 * t) + 0.2 * sin(2 * .pi * 700 * t)))
    }
}

var report: [String: Any] = [:]
report["rssBeforeMB"] = round2(residentMB())

do {
    // --- Model load ---------------------------------------------------------
    let loadStart = CFAbsoluteTimeGetCurrent()
    let models = try await AsrModels.downloadAndLoad()
    let loadSeconds = CFAbsoluteTimeGetCurrent() - loadStart
    report["modelLoadSeconds"] = round2(loadSeconds)
    report["rssAfterLoadMB"] = round2(residentMB())

    let cache = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("FluidAudio")
    if FileManager.default.fileExists(atPath: cache.path) {
        report["modelCacheMB"] = directorySizeMB(cache)
        report["modelCachePath"] = cache.path
    }

    // Models are handed to the manager at init — the supported way to reuse an
    // already-downloaded set rather than fetching again.
    let asr = AsrManager(config: .default, models: models)

    // --- Audio --------------------------------------------------------------
    let sampleRate: Double = 16_000
    var samples: [Float]
    var audioSeconds: Double

    if let path = flag("file") {
        let url = URL(fileURLWithPath: path)
        let file = try AVAudioFile(forReading: url)
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32, sampleRate: file.fileFormat.sampleRate, channels: 1,
            interleaved: false)!
        let pcm = AVAudioPCMBuffer(
            pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length))!
        try file.read(into: pcm)
        samples = Array(
            UnsafeBufferPointer(start: pcm.floatChannelData![0], count: Int(pcm.frameLength)))
        audioSeconds = Double(samples.count) / file.fileFormat.sampleRate
        report["source"] = url.lastPathComponent
    } else {
        audioSeconds = 30
        samples = syntheticSpeechLike(seconds: audioSeconds, sampleRate: sampleRate)
        report["source"] = "synthetic (measures the pipeline, not accuracy)"
    }
    report["audioSeconds"] = round2(audioSeconds)

    // --- Transcribe ---------------------------------------------------------
    var decoderState = try TdtDecoderState()
    let start = CFAbsoluteTimeGetCurrent()
    let result = try await asr.transcribe(samples, decoderState: &decoderState)
    let elapsed = CFAbsoluteTimeGetCurrent() - start

    let rtf = elapsed / audioSeconds
    report["transcribeSeconds"] = round2(elapsed)
    report["realtimeFactor"] = round2(rtf)
    report["realtimeMultiple"] = round2(1 / max(rtf, 0.000001))
    report["withinBudget"] = rtf < 0.3
    report["rssPeakMB"] = round2(residentMB())
    report["text"] = String(result.text.prefix(280))

    // §9 needs every generated line to point back at the second of audio it
    // came from. Word timings are what make that possible at all.
    if let timings = result.tokenTimings {
        let words = buildWordTimings(from: timings)
        report["wordTimings"] = words.count
        report["hasWordLevelTimings"] = !words.isEmpty
        if let first = words.first {
            report["firstWord"] = ["word": first.word, "start": round2(first.startTime)]
        }
    } else {
        report["hasWordLevelTimings"] = false
    }
} catch {
    report["error"] = "\(error)"
}

if asJSON {
    let data = try! JSONSerialization.data(
        withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    print(String(data: data, encoding: .utf8)!)
} else {
    print("on-device ASR · FluidAudio (Parakeet) · budget RTF < 0.3")
    for key in report.keys.sorted() {
        print("  \(key.padding(toLength: 24, withPad: " ", startingAt: 0)) \(report[key]!)")
    }
}
