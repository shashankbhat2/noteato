import Foundation
import Testing

@testable import AgentCore

@Suite("Framing")
struct FramingTests {
    @Test("round-trips a single frame")
    func roundTrip() throws {
        let payload = Data(#"{"type":"ping"}"#.utf8)
        var buffer = Framing.encode(payload)
        #expect(try Framing.decode(from: &buffer) == [payload])
        #expect(buffer.isEmpty)
    }

    @Test("splits several frames arriving in one read")
    func coalescedFrames() throws {
        let a = Data(#"{"type":"ping"}"#.utf8)
        let b = Data(#"{"type":"openLibrary"}"#.utf8)
        var buffer = Framing.encode(a) + Framing.encode(b)
        #expect(try Framing.decode(from: &buffer) == [a, b])
        #expect(buffer.isEmpty)
    }

    @Test("holds a partial frame until the rest of it arrives")
    func partialFrame() throws {
        let payload = Data(#"{"type":"hello","pid":1234}"#.utf8)
        let encoded = Framing.encode(payload)
        let split = encoded.count - 5

        var buffer = encoded.prefix(split)
        #expect(try Framing.decode(from: &buffer).isEmpty)
        #expect(buffer.count == split)

        buffer.append(encoded.suffix(from: split))
        #expect(try Framing.decode(from: &buffer) == [payload])
        #expect(buffer.isEmpty)
    }

    @Test("waits when only part of the length prefix has arrived")
    func partialLengthPrefix() throws {
        var buffer = Data([0, 0])
        #expect(try Framing.decode(from: &buffer).isEmpty)
        #expect(buffer.count == 2)
    }

    @Test("carries an empty payload")
    func emptyPayload() throws {
        var buffer = Framing.encode(Data())
        #expect(try Framing.decode(from: &buffer) == [Data()])
    }

    @Test("refuses an oversized frame instead of allocating for it")
    func oversizedFrame() {
        var length = UInt32(Framing.maxFrameBytes + 1).bigEndian
        var buffer = Data()
        withUnsafeBytes(of: &length) { buffer.append(contentsOf: $0) }
        #expect(throws: Framing.DecodeError.frameTooLarge(Framing.maxFrameBytes + 1)) {
            _ = try Framing.decode(from: &buffer)
        }
    }
}
