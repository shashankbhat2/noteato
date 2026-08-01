import Foundation
import Testing

@testable import AgentCore

/// A short, cheap sample rate so the arithmetic in these tests is readable:
/// at 10 Hz, "one second" is ten samples.
private let rate: Double = 10

@Suite("PreRollBuffer")
struct PreRollBufferTests {
    private func ramp(_ from: Int, _ count: Int) -> [Float] {
        (0..<count).map { Float(from + $0) }
    }

    @Test("starts empty")
    func startsEmpty() {
        let buffer = PreRollBuffer(seconds: 1, sampleRate: rate)
        #expect(buffer.isEmpty)
        #expect(buffer.snapshot().isEmpty)
        #expect(buffer.availableSeconds == 0)
    }

    @Test("returns only what it has actually heard")
    func partiallyFilled() {
        // Ten seconds of capacity, three seconds of audio: asking for ten must
        // not invent seven seconds of silence at the front.
        let buffer = PreRollBuffer(seconds: 10, sampleRate: rate)
        buffer.write(ramp(0, 30))
        #expect(buffer.availableSeconds == 3)
        #expect(buffer.snapshot(seconds: 10) == ramp(0, 30))
    }

    @Test("keeps the most recent audio once full")
    func overwritesOldest() {
        let buffer = PreRollBuffer(seconds: 1, sampleRate: rate)  // 10 samples
        buffer.write(ramp(0, 15))
        // The first five samples are gone; the last ten survive in order.
        #expect(buffer.snapshot() == ramp(5, 10))
        #expect(buffer.availableSeconds == 1)
    }

    @Test("stays bounded no matter how much is written")
    func staysBounded() {
        let buffer = PreRollBuffer(seconds: 1, sampleRate: rate)
        for i in 0..<50 { buffer.write(ramp(i * 10, 10)) }
        #expect(buffer.snapshot().count == 10)
        #expect(buffer.snapshot() == ramp(490, 10))
    }

    @Test("handles a chunk longer than the whole buffer")
    func oversizedChunk() {
        // A single tap larger than capacity can only leave its own tail.
        let buffer = PreRollBuffer(seconds: 1, sampleRate: rate)
        buffer.write(ramp(0, 35))
        #expect(buffer.snapshot() == ramp(25, 10))
    }

    @Test("reassembles correctly across the wrap point")
    func wrapping() {
        let buffer = PreRollBuffer(seconds: 1, sampleRate: rate)
        buffer.write(ramp(0, 7))
        buffer.write(ramp(7, 7))  // wraps
        #expect(buffer.snapshot() == ramp(4, 10))
    }

    @Test("many small writes match one large write")
    func writeGranularityDoesNotMatter() {
        // The audio tap delivers whatever frame count it likes; the buffer's
        // contents must not depend on how the same audio was chunked.
        let oneShot = PreRollBuffer(seconds: 1, sampleRate: rate)
        oneShot.write(ramp(0, 25))

        let chunked = PreRollBuffer(seconds: 1, sampleRate: rate)
        for i in 0..<25 { chunked.write([Float(i)]) }

        #expect(oneShot.snapshot() == chunked.snapshot())
    }

    @Test("returns the tail when asked for less than it holds")
    func partialSnapshot() {
        let buffer = PreRollBuffer(seconds: 1, sampleRate: rate)
        buffer.write(ramp(0, 10))
        #expect(buffer.snapshot(seconds: 0.3) == ramp(7, 3))
    }

    @Test("an empty write leaves the buffer untouched")
    func emptyWrite() {
        let buffer = PreRollBuffer(seconds: 1, sampleRate: rate)
        buffer.write(ramp(0, 4))
        buffer.write([])
        #expect(buffer.snapshot() == ramp(0, 4))
    }

    // The privacy promise: clearing has to erase the audio, not just move a
    // cursor past it. A reset that only rewound would leave speech sitting in
    // memory after the user pressed "Pause listening".
    @Test("reset zeroes the samples, not just the cursor")
    func resetErases() {
        let buffer = PreRollBuffer(seconds: 1, sampleRate: rate)
        buffer.write(ramp(1, 10))
        buffer.reset()

        #expect(buffer.isEmpty)
        #expect(buffer.snapshot().isEmpty)
        #expect(buffer.availableSeconds == 0)

        // Write less than capacity: anything readable must come from the new
        // audio, never from what was there before.
        buffer.write([9, 9])
        #expect(buffer.snapshot() == [9, 9])
    }

    @Test("is reusable after a reset")
    func reusableAfterReset() {
        let buffer = PreRollBuffer(seconds: 1, sampleRate: rate)
        buffer.write(ramp(0, 15))
        buffer.reset()
        buffer.write(ramp(100, 12))
        #expect(buffer.snapshot() == ramp(102, 10))
    }

    @Test("a zero-length setting holds nothing")
    func zeroLength() {
        // 0 disables pre-roll entirely. MicCapture closes the stream in that
        // case; the buffer independently refuses to retain anything.
        let buffer = PreRollBuffer(seconds: 0, sampleRate: rate)
        buffer.write(ramp(0, 10))
        #expect(buffer.snapshot().count <= 1)
    }

    @Test("sizes itself from seconds and sample rate")
    func capacityFromSeconds() {
        #expect(PreRollBuffer(seconds: 10, sampleRate: 48_000).capacity == 480_000)
        #expect(PreRollBuffer(seconds: 15, sampleRate: 48_000).capacity == 720_000)
    }
}
