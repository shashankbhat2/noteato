// Diagnostic for the dictation loop, without the hotkey or the target app.
//
//   swift run -c release DictateProbe [--seconds 8]
//
// Drives MicCapture -> DictationSession directly and reports what came back, so
// a failure can be pinned to a stage instead of "nothing appeared in TextEdit":
// did the model load, did the session reach .listening, did audio arrive, did
// the decoder ever *confirm* anything, and did the final flush produce a tail.
import AVFoundation
import AgentCore
import Foundation

let argv = CommandLine.arguments
let seconds = Double(argv.firstIndex(of: "--seconds").map { argv[$0 + 1] } ?? "8") ?? 8

let phrases = Mutex()
final class Mutex: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String] = []
    private var states: [String] = []
    private var buffers = 0
    func add(_ s: String) {
        lock.lock()
        items.append(s)
        lock.unlock()
    }
    func countBuffer() {
        lock.lock()
        buffers += 1
        lock.unlock()
    }
    func bufferCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return buffers
    }
    func state(_ s: String) {
        lock.lock()
        states.append(s)
        lock.unlock()
    }
    func snapshot() -> ([String], [String]) {
        lock.lock()
        defer { lock.unlock() }
        return (items, states)
    }
}

var report: [String: Any] = [:]

let mic = MicCapture(preRollSeconds: 10)
report["micStarted"] = mic.startListening()
report["sampleRate"] = mic.sampleRate

let session = DictationSession()
await session.setHandlers(
    onPhrase: { phrases.add($0) },
    onStateChange: { phrases.state("\($0)") }
)

await session.setSampleRate(mic.sampleRate)
let loadStart = Date()
await session.start()
report["modelLoadSeconds"] = (Date().timeIntervalSince(loadStart) * 100).rounded() / 100
report["stateAfterStart"] = "\(await session.currentState())"

mic.onAudio = { pcm in
    guard let channels = pcm.floatChannelData, pcm.frameLength > 0 else { return }
    let samples = Array(UnsafeBufferPointer(start: channels[0], count: Int(pcm.frameLength)))
    phrases.countBuffer()
    session.accept(samples: samples)
}

print("DictateProbe: listening for \(seconds)s — speak now")
try? await Task.sleep(for: .seconds(seconds))

let (during, states) = phrases.snapshot()
report["buffersForwarded"] = phrases.bufferCount()
report["confirmedPhrasesDuring"] = during
report["confirmedDuringCount"] = during.count

let tail = await session.stop()
report["flushedTail"] = tail
let (afterAll, statesAfter) = phrases.snapshot()
report["allPhrases"] = afterAll
report["assembled"] = afterAll.joined()
report["states"] = statesAfter
report["anyTextAtAll"] = !afterAll.joined().trimmingCharacters(in: .whitespaces).isEmpty

mic.stopListening()

let data = try! JSONSerialization.data(
    withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
print("DICTATE_PROBE " + String(data: data, encoding: .utf8)!)
