// swift-tools-version: 6.0
import PackageDescription

// NoteatoAgent — the resident native process (docs/revamp/phase-plan.md §Phase 1).
// Phase 0.5 stands the package up so CI proves the Swift toolchain before
// Phase 1 depends on it. Only the wire protocol is real so far.
let package = Package(
    name: "NoteatoAgent",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "AgentCore"),
        .executableTarget(name: "NoteatoAgent", dependencies: ["AgentCore"]),
        // The §10 hotkey→HUD gate. Lives in this package so that Phase 1 can
        // point it at the agent's real HUD instead of measuring a replica.
        .executableTarget(name: "PanelBench", dependencies: ["AgentCore"]),
        .testTarget(name: "AgentCoreTests", dependencies: ["AgentCore"])
    ]
)
