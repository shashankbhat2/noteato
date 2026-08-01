import Foundation

/// Length-prefixed framing for the agent socket at
/// `~/Library/Application Support/Noteato/agent.sock`.
///
/// Each frame is a 4-byte big-endian unsigned length followed by that many bytes
/// of UTF-8 JSON. A stream socket makes no promise about message boundaries, so
/// the decoder has to tolerate a frame arriving in pieces and several frames
/// arriving at once — which is the part that gets skipped and then debugged
/// later under load.
public enum Framing {
    /// Frames larger than this are refused rather than allocated. The agent
    /// exchanges commands and search results, not audio; anything this size is a
    /// bug or a hostile peer on the socket.
    public static let maxFrameBytes = 8 * 1024 * 1024

    public enum DecodeError: Error, Equatable {
        case frameTooLarge(Int)
    }

    public static func encode(_ payload: Data) -> Data {
        var out = Data(capacity: payload.count + 4)
        var length = UInt32(payload.count).bigEndian
        withUnsafeBytes(of: &length) { out.append(contentsOf: $0) }
        out.append(payload)
        return out
    }

    /// Pulls every complete frame off the front of `buffer`, leaving any partial
    /// frame behind for the next read.
    public static func decode(from buffer: inout Data) throws -> [Data] {
        var frames: [Data] = []
        while buffer.count >= 4 {
            let length = buffer.prefix(4).reduce(into: UInt32(0)) { $0 = ($0 << 8) | UInt32($1) }
            let count = Int(length)
            if count > maxFrameBytes { throw DecodeError.frameTooLarge(count) }
            guard buffer.count >= 4 + count else { break }
            frames.append(buffer.subdata(in: 4..<(4 + count)))
            buffer.removeSubrange(0..<(4 + count))
        }
        return frames
    }
}
