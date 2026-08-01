import Darwin
import Foundation
import Testing

@testable import AgentCore

@Suite("Protocol")
struct ProtocolTests {
    @Test("round-trips an agent message")
    func agentRoundTrip() throws {
        let message = AgentMessage(type: .welcome, version: "1.2.3", pid: 42, protocolVersion: 1)
        let decoded = Codec.decodeAgent(try Codec.encode(message))
        #expect(decoded == message)
    }

    @Test("decodes a client message with only the fields it carries")
    func sparseClientMessage() {
        let data = Data(#"{"type":"ping"}"#.utf8)
        let decoded = Codec.decodeClient(data)
        #expect(decoded?.type == .ping)
        #expect(decoded?.pid == nil)
    }

    @Test("returns nil for a type this build does not know, rather than throwing")
    func unknownType() {
        // Forward compatibility: a newer peer's message must not be fatal.
        #expect(Codec.decodeClient(Data(#"{"type":"startCapture"}"#.utf8)) == nil)
    }

    @Test("returns nil for malformed JSON")
    func malformed() {
        #expect(Codec.decodeClient(Data("not json".utf8)) == nil)
    }
}

@Suite("SocketServer")
struct SocketServerTests {
    /// A short unique path — sockaddr_un.sun_path is 104 bytes on Darwin, and
    /// the default temp dir plus a UUID gets close enough to matter.
    private func tempSocketPath() -> String {
        "/tmp/noteato-test-\(UUID().uuidString.prefix(8)).sock"
    }

    /// Minimal client: connects, writes framed JSON, reads framed JSON back.
    private func connectClient(to path: String) -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutablePointer(to: &addr.sun_path) {
            $0.withMemoryRebound(to: CChar.self, capacity: 104) { _ = strcpy($0, path) }
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        _ = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, size) }
        }
        return fd
    }

    @Test("accepts a client and delivers its message")
    func receivesMessage() async throws {
        let path = tempSocketPath()
        let server = SocketServer(path: path)
        defer { server.stop() }

        let received = Mailbox()
        server.onMessage = { received.put($0) }
        try server.start()

        let fd = connectClient(to: path)
        defer { close(fd) }

        let payload = try JSONEncoder().encode(
            ClientMessage(type: .hello, pid: 7, protocolVersion: 1))
        let frame = Framing.encode(payload)
        _ = frame.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }

        let message = try #require(await received.take(timeout: 2))
        #expect(message.type == .hello)
        #expect(message.pid == 7)
    }

    @Test("reports whether a client is attached")
    func tracksClient() async throws {
        let path = tempSocketPath()
        let server = SocketServer(path: path)
        defer { server.stop() }
        try server.start()
        #expect(server.hasClient == false)

        let fd = connectClient(to: path)
        // Give the accept source a turn.
        try await Task.sleep(for: .milliseconds(200))
        #expect(server.hasClient == true)

        close(fd)
        try await Task.sleep(for: .milliseconds(300))
        #expect(server.hasClient == false)
    }

    @Test("sending with no client attached is a no-op, not a failure")
    func sendWithoutClient() throws {
        // The library being closed must never affect the agent (brief §2).
        let server = SocketServer(path: tempSocketPath())
        defer { server.stop() }
        try server.start()
        server.send(AgentMessage(type: .hudDidShow))
    }

    @Test("replaces a socket file left behind by a crashed agent")
    func staleSocketFile() throws {
        let path = tempSocketPath()
        FileManager.default.createFile(atPath: path, contents: Data())
        let server = SocketServer(path: path)
        defer { server.stop() }
        // Without the unlink in start(), bind() would fail with EADDRINUSE and
        // the agent would never come back after an unclean exit.
        try server.start()
        #expect(server.hasClient == false)
    }
}

/// Collects values delivered on the server's queue so a test can await them.
private final class Mailbox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: ClientMessage?

    func put(_ message: ClientMessage) {
        lock.lock()
        value = message
        lock.unlock()
    }

    private func read() -> ClientMessage? {
        // Kept synchronous and non-inlined: NSLock is unavailable from an async
        // context, so the critical section must not span a suspension point.
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func take(timeout seconds: Double) async -> ClientMessage? {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if let current = read() { return current }
            try? await Task.sleep(for: .milliseconds(25))
        }
        return nil
    }
}
