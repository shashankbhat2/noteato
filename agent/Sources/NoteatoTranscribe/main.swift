// Transcribes one committed capture, then exits.
//
//   NoteatoTranscribe <note-directory>
//
// A separate process on purpose. Transcription peaks around 133 MB and the
// resident agent is held to 150 MB with the microphone already open, so the
// model cannot live there. Spawning and exiting keeps the agent lean by
// construction rather than by unloading a model at exactly the right moment —
// and it means a crash in the ASR stack cannot take the capture process with it.
import AgentCore
import Foundation

let arguments = CommandLine.arguments
guard arguments.count > 1 else {
    FileHandle.standardError.write(Data("usage: NoteatoTranscribe <note-directory>\n".utf8))
    exit(2)
}

let directory = URL(fileURLWithPath: arguments[1])
let quiet = arguments.contains("--quiet")

do {
    let transcript = try await Transcriber.process(noteDirectory: directory)
    if !quiet {
        let payload: [String: Any] = [
            "directory": directory.lastPathComponent,
            "words": transcript.words.count,
            "durationSeconds": (transcript.durationSeconds * 100).rounded() / 100,
            "text": String(transcript.text.prefix(200))
        ]
        let data = try JSONSerialization.data(
            withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
        print(String(data: data, encoding: .utf8)!)
    }
    exit(0)
} catch {
    // The agent reads this; a capture whose transcription failed still has its
    // audio, which is the part that cannot be regenerated.
    FileHandle.standardError.write(
        Data("NoteatoTranscribe: \(error.localizedDescription)\n".utf8))
    exit(1)
}
