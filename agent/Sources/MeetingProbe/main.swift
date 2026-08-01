// Diagnostic for §8's dual-stream capture.
//
//   swift run -c release MeetingProbe [--seconds 5]
//
// The phase plan flagged one thing to verify rather than plan around: macOS 15
// introduced periodic re-authorisation prompts for screen capture, and the
// behaviour on 26.x was unknown. This answers that empirically — whether the
// permission is held, whether a stream actually starts, and whether audio
// arrives — instead of guessing.
//
// Play something audible while it runs; silence and "no permission" look
// identical from the outside otherwise, which is the confusion worth removing.
import AgentCore
import Foundation

let argv = CommandLine.arguments
let seconds =
    Double(
        argv.firstIndex(of: "--seconds").map { argv[$0 + 1] } ?? "5") ?? 5

var report: [String: Any] = [:]
report["screenRecordingGranted"] = SystemAudioCapture.hasPermission

let capture = SystemAudioCapture()
do {
    try await capture.start()
    report["streamStarted"] = true

    try await Task.sleep(for: .seconds(seconds))
    let heard = capture.capturedSeconds
    report["capturedSeconds"] = (heard * 100).rounded() / 100
    // A stream that starts but delivers nothing is the failure mode that looks
    // like success, so it gets its own line.
    report["audioActuallyArriving"] = heard > seconds * 0.5

    let samples = await capture.stop()
    report["sampleCount"] = samples.count
    let peak = samples.reduce(Float(0)) { max($0, abs($1)) }
    report["peakLevel"] = Double((peak * 1000).rounded()) / 1000
    report["heardSomethingAudible"] = peak > 0.001
    report["bufferClearedAfterStop"] = capture.capturedSeconds == 0
} catch {
    report["streamStarted"] = false
    report["error"] = "\(error.localizedDescription)"
}

let data = try! JSONSerialization.data(
    withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
print("MEETING_PROBE " + String(data: data, encoding: .utf8)!)
