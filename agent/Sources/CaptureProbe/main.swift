// Diagnostic for the capture path, end to end, against the real microphone.
//
//   swift run -c release CaptureProbe [--seconds 3] [--commit <vault>]
//
// It exists because the interesting failures here are environmental rather than
// logical: microphone permission not granted, a device at an unexpected sample
// rate, an encoder that refuses. Unit tests cannot see any of those, and
// discovering them by pressing the hotkey and wondering why the file is empty
// is a bad way to find out.
import AVFoundation
import AgentCore
import Foundation

let argv = CommandLine.arguments
func flag(_ name: String) -> String? {
    guard let i = argv.firstIndex(of: "--\(name)"), i + 1 < argv.count else { return nil }
    return argv[i + 1]
}

let seconds = Double(flag("seconds") ?? "3") ?? 3
let commitTo = flag("commit")

var report: [String: Any] = [:]

// Permission first: everything below is meaningless without it, and the
// failure mode otherwise is an empty file rather than an error.
let status = AVCaptureDevice.authorizationStatus(for: .audio)
report["permission"] =
    ["authorized", "denied", "restricted", "notDetermined"][
        [.authorized, .denied, .restricted, .notDetermined].firstIndex(of: status) ?? 3]

if status == .notDetermined {
    let semaphore = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { _ in semaphore.signal() }
    _ = semaphore.wait(timeout: .now() + 30)
    report["permissionAfterPrompt"] =
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized ? "authorized" : "denied"
}

let mic = MicCapture(preRollSeconds: 10)
let started = mic.startListening()
report["engineStarted"] = started
report["state"] = "\(mic.state)"

if started {
    report["sampleRate"] = mic.sampleRate

    // Fill the pre-roll, then check that time is actually accumulating — a mic
    // that is open but delivering nothing looks identical from the outside.
    Thread.sleep(forTimeInterval: seconds)
    let buffered = mic.bufferedSeconds
    report["bufferedSeconds"] = (buffered * 100).rounded() / 100
    report["bufferIsFilling"] = buffered > seconds * 0.5
    report["levelSeen"] = mic.currentLevel > 0.0001

    // The pre-roll claim: begin a capture and immediately end it. Everything in
    // the result predates the call to beginCapture().
    mic.beginCapture()
    let samples = mic.endCapture(keep: true)
    let preRollSeconds = Double(samples.count) / mic.sampleRate
    report["preRollCapturedSeconds"] = (preRollSeconds * 100).rounded() / 100
    report["capturedAudioFromBeforeTheKeypress"] = preRollSeconds > seconds * 0.5

    // The buffer must be empty afterwards, whether kept or discarded.
    report["bufferClearedAfterCommit"] = mic.bufferedSeconds < 0.2

    if let vault = commitTo, !samples.isEmpty {
        do {
            let committed = try CaptureWriter.commit(
                samples: samples, sampleRate: mic.sampleRate,
                vault: URL(fileURLWithPath: vault))
            let size =
                (try? FileManager.default.attributesOfItem(atPath: committed.audio.path)[.size]
                    as? Int) ?? 0
            report["committedTo"] = committed.directory.lastPathComponent
            report["audioBytes"] = size ?? 0
            report["durationSeconds"] = (committed.duration * 100).rounded() / 100
        } catch {
            report["commitError"] = "\(error)"
        }
    }

    mic.stopListening()
    report["stateAfterStop"] = "\(mic.state)"
}

let data = try! JSONSerialization.data(
    withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
print("CAPTURE_PROBE " + String(data: data, encoding: .utf8)!)
