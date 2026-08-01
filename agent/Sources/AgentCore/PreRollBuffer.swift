import Foundation

/// The last N seconds of microphone audio, held in memory and nothing else.
///
/// This is what makes capture start *before* the keypress: when the hotkey
/// fires, the recording already contains the seconds leading up to it, so the
/// first few words — the ones every other tool loses while its UI wakes up —
/// are already there.
///
/// Three properties this type has to hold, because the feature's credibility
/// rests on them more than on its latency:
///
/// - **Fixed allocation.** The storage is sized once at init and never grows.
///   A buffer that reallocated on a mic thread would drop frames and churn the
///   heap in the process that has to stay under 150 MB.
/// - **Bounded.** Writing more than capacity overwrites the oldest audio. Time
///   only moves forward; the buffer never gets longer than it promised.
/// - **Forgettable.** `reset()` zeroes the samples rather than only rewinding
///   the cursor, so audio cannot be recovered from a buffer that was cleared.
///   Pause, quit and every commit all clear it, and that is a promise about
///   what is in memory, not just what the reader returns.
///
/// Not thread-safe by itself: the audio tap writes on the capture thread and
/// reads happen on commit. `MicCapture` owns the serialisation.
public final class PreRollBuffer {
    /// 48 kHz mono Float32. 15 s — the maximum the setting allows — is 2.9 MB,
    /// which is irrelevant against the agent's budget, so the buffer is sized
    /// for the maximum once rather than resized when the setting changes.
    public let sampleRate: Double
    public let capacity: Int

    private var storage: [Float]
    private var writeIndex = 0
    /// Total samples ever written. Used to tell "wrapped" from "partly filled"
    /// without a separate flag that could disagree with the cursor.
    private var written = 0

    public init(seconds: Double, sampleRate: Double = 48_000) {
        self.sampleRate = sampleRate
        self.capacity = max(1, Int(seconds * sampleRate))
        self.storage = [Float](repeating: 0, count: capacity)
    }

    /// Seconds currently held, up to the buffer's length.
    public var availableSeconds: Double {
        Double(min(written, capacity)) / sampleRate
    }

    public var isEmpty: Bool { written == 0 }

    /// Append samples, overwriting the oldest audio once full.
    ///
    /// Takes an `UnsafeBufferPointer` because the caller is an audio tap
    /// holding an `AVAudioPCMBuffer`'s channel data — copying it into an Array
    /// first would allocate on the audio thread, which is the one place that
    /// must not.
    public func write(_ samples: UnsafeBufferPointer<Float>) {
        guard let base = samples.baseAddress, !samples.isEmpty else { return }
        let count = samples.count

        // A chunk longer than the whole buffer can only leave its own tail.
        if count >= capacity {
            let tail = base + (count - capacity)
            storage.withUnsafeMutableBufferPointer { dst in
                dst.baseAddress!.update(from: tail, count: capacity)
            }
            writeIndex = 0
            written += count
            return
        }

        let firstChunk = min(count, capacity - writeIndex)
        storage.withUnsafeMutableBufferPointer { dst in
            dst.baseAddress!.advanced(by: writeIndex).update(from: base, count: firstChunk)
            if firstChunk < count {
                dst.baseAddress!.update(from: base + firstChunk, count: count - firstChunk)
            }
        }
        writeIndex = (writeIndex + count) % capacity
        written += count
    }

    /// Convenience for tests and non-realtime callers.
    public func write(_ samples: [Float]) {
        samples.withUnsafeBufferPointer { write($0) }
    }

    /// Everything held, oldest first.
    public func snapshot() -> [Float] {
        snapshot(seconds: availableSeconds)
    }

    /// The most recent `seconds` of audio, oldest first.
    ///
    /// Asking for more than is held returns what there is — a buffer that has
    /// only been running for two seconds cannot invent ten, and padding with
    /// silence would put a lie at the front of the recording.
    public func snapshot(seconds: Double) -> [Float] {
        let wanted = min(Int(seconds * sampleRate), min(written, capacity))
        guard wanted > 0 else { return [] }

        var out = [Float](repeating: 0, count: wanted)
        // Where the wanted window starts, walking back from the write cursor.
        let start = ((writeIndex - wanted) % capacity + capacity) % capacity
        let firstChunk = min(wanted, capacity - start)
        storage.withUnsafeBufferPointer { src in
            out.withUnsafeMutableBufferPointer { dst in
                dst.baseAddress!.update(from: src.baseAddress! + start, count: firstChunk)
                if firstChunk < wanted {
                    dst.baseAddress!.advanced(by: firstChunk)
                        .update(from: src.baseAddress!, count: wanted - firstChunk)
                }
            }
        }
        return out
    }

    /// Forget everything held. Zeroes the samples, not just the cursor.
    public func reset() {
        storage.withUnsafeMutableBufferPointer { dst in
            dst.baseAddress!.update(repeating: 0, count: dst.count)
        }
        writeIndex = 0
        written = 0
    }
}
