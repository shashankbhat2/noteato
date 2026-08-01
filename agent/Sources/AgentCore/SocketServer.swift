import Darwin
import Foundation

/// A Unix-domain socket server speaking length-prefixed JSON.
///
/// All state is confined to `queue`; every callback is delivered on it. That
/// confinement is what makes the `@unchecked Sendable` below true, so nothing
/// here may be touched from another thread.
public final class SocketServer: @unchecked Sendable {
    public typealias MessageHandler = @Sendable (ClientMessage) -> Void

    private let path: String
    private let queue = DispatchQueue(label: "com.noteato.agent.socket")
    private var listenFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?
    private var connections: [Int32: Connection] = [:]

    private final class Connection {
        let fd: Int32
        let source: DispatchSourceRead
        var buffer = Data()
        init(fd: Int32, source: DispatchSourceRead) {
            self.fd = fd
            self.source = source
        }
    }

    public var onMessage: MessageHandler?
    public var onConnect: (@Sendable () -> Void)?
    public var onDisconnect: (@Sendable () -> Void)?

    /// True while at least one client (the library) is connected.
    public var hasClient: Bool {
        queue.sync { !connections.isEmpty }
    }

    public init(path: String = Wire.socketURL().path) {
        self.path = path
    }

    public enum StartError: Error {
        case createFailed(Int32)
        case pathTooLong
        case bindFailed(Int32)
        case listenFailed(Int32)
    }

    public func start() throws {
        try queue.sync {
            try FileManager.default.createDirectory(
                at: URL(fileURLWithPath: path).deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            // A socket file left by a crashed agent would make bind() fail with
            // EADDRINUSE even though nothing is listening. Removing it is safe
            // because only one agent is meant to own this path.
            unlink(path)

            let fd = socket(AF_UNIX, SOCK_STREAM, 0)
            guard fd >= 0 else { throw StartError.createFailed(errno) }

            var addr = sockaddr_un()
            addr.sun_family = sa_family_t(AF_UNIX)
            let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
            guard path.utf8.count < maxLen else {
                close(fd)
                throw StartError.pathTooLong
            }
            withUnsafeMutablePointer(to: &addr.sun_path) { tuplePtr in
                tuplePtr.withMemoryRebound(to: CChar.self, capacity: maxLen) { dst in
                    _ = strcpy(dst, path)
                }
            }

            let size = socklen_t(MemoryLayout<sockaddr_un>.size)
            let bound = withUnsafePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, size) }
            }
            guard bound == 0 else {
                close(fd)
                throw StartError.bindFailed(errno)
            }
            guard listen(fd, 4) == 0 else {
                close(fd)
                throw StartError.listenFailed(errno)
            }

            listenFD = fd
            let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
            source.setEventHandler { [weak self] in self?.accept() }
            source.resume()
            acceptSource = source
        }
    }

    public func stop() {
        queue.sync {
            for (_, connection) in connections {
                connection.source.cancel()
                close(connection.fd)
            }
            connections.removeAll()
            acceptSource?.cancel()
            acceptSource = nil
            if listenFD >= 0 {
                close(listenFD)
                listenFD = -1
            }
            unlink(path)
        }
    }

    /// Broadcast to every connected client. A no-op when none is connected,
    /// which is the normal state whenever the library is closed.
    public func send(_ message: AgentMessage) {
        guard let payload = try? Codec.encode(message) else { return }
        let frame = Framing.encode(payload)
        queue.async { [weak self] in
            guard let self else { return }
            for (fd, _) in self.connections { self.write(frame, to: fd) }
        }
    }

    // MARK: - Private (queue-confined)

    private func accept() {
        let fd = Darwin.accept(listenFD, nil, nil)
        guard fd >= 0 else { return }
        // Without this a write to a client that vanished raises SIGPIPE and
        // takes the agent down with it — the exact failure the agent must not
        // have, since it is the process that has to stay up.
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))

        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        let connection = Connection(fd: fd, source: source)
        connections[fd] = connection

        source.setEventHandler { [weak self] in self?.readAvailable(on: fd) }
        source.setCancelHandler { [weak self] in
            guard let self else { return }
            if self.connections.removeValue(forKey: fd) != nil {
                close(fd)
                self.onDisconnect?()
            }
        }
        source.resume()
        onConnect?()
    }

    private func readAvailable(on fd: Int32) {
        guard let connection = connections[fd] else { return }
        var chunk = [UInt8](repeating: 0, count: 8192)
        let n = read(fd, &chunk, chunk.count)
        if n <= 0 {
            connection.source.cancel()
            return
        }
        connection.buffer.append(contentsOf: chunk[0..<n])

        let frames: [Data]
        do {
            frames = try Framing.decode(from: &connection.buffer)
        } catch {
            // An oversized length prefix means the peer is out of sync or
            // hostile; drop it rather than trying to resynchronise a stream
            // whose framing can no longer be trusted.
            connection.source.cancel()
            return
        }
        for frame in frames {
            if let message = Codec.decodeClient(frame) { onMessage?(message) }
        }
    }

    private func write(_ data: Data, to fd: Int32) {
        data.withUnsafeBytes { raw in
            guard var pointer = raw.baseAddress else { return }
            var remaining = raw.count
            while remaining > 0 {
                let written = Darwin.write(fd, pointer, remaining)
                if written <= 0 { return }
                pointer += written
                remaining -= written
            }
        }
    }
}
