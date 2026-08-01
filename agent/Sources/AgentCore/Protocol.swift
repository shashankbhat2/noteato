import Foundation

/// The wire protocol spoken over `agent.sock`.
///
/// The agent is the source of truth and Electron is a client: the library being
/// closed must never block or degrade capture (revamp brief §2). Nothing here
/// may therefore require a client to be connected — messages to Electron are
/// fire-and-forget, and the agent's own work continues regardless.
///
/// Frames are length-prefixed JSON (see `Framing`). Both sides tag messages with
/// `type`, and both sides ignore types they do not recognise, so a newer agent
/// paired with an older library degrades to the intersection rather than
/// failing to connect.
public enum Wire {
    /// The socket path. Under `Application Support` rather than a temp dir so it
    /// shares the app's own directory and survives reboots predictably.
    public static func socketURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Noteato/agent.sock")
    }

    /// Bumped when a change is not backward compatible. Clients report their own;
    /// the agent logs a mismatch rather than refusing, since refusing to talk to
    /// a stale library is a worse failure than talking to it carefully.
    public static let protocolVersion = 1
}

// MARK: - Client → agent

public struct ClientMessage: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case hello
        case ping
        /// The library is closing; the agent keeps running.
        case goodbye
    }

    public var type: Kind
    public var pid: Int?
    public var protocolVersion: Int?

    public init(type: Kind, pid: Int? = nil, protocolVersion: Int? = nil) {
        self.type = type
        self.pid = pid
        self.protocolVersion = protocolVersion
    }
}

// MARK: - Agent → client

public struct AgentMessage: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case welcome
        case pong
        /// The menu bar asked for the library while it was already running.
        case showLibrary
        /// The HUD opened or closed. Phase 1 carries no capture payload yet.
        case hudDidShow
        case hudDidHide
    }

    public var type: Kind
    public var version: String?
    public var pid: Int?
    public var protocolVersion: Int?

    public init(type: Kind, version: String? = nil, pid: Int? = nil, protocolVersion: Int? = nil) {
        self.type = type
        self.version = version
        self.pid = pid
        self.protocolVersion = protocolVersion
    }
}

public enum Codec {
    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()

    public static func encode(_ message: AgentMessage) throws -> Data {
        try encoder.encode(message)
    }

    /// Returns nil for a well-formed frame carrying a type this build does not
    /// know — see the forward-compatibility note on `Wire`.
    public static func decodeClient(_ data: Data) -> ClientMessage? {
        try? decoder.decode(ClientMessage.self, from: data)
    }

    public static func decodeAgent(_ data: Data) -> AgentMessage? {
        try? decoder.decode(AgentMessage.self, from: data)
    }
}
