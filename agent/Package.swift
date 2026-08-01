// swift-tools-version: 6.0
import PackageDescription

// NoteatoAgent — the resident native process (docs/revamp/phase-plan.md §Phase 1).
// Phase 0.5 stands the package up so CI proves the Swift toolchain before
// Phase 1 depends on it. Only the wire protocol is real so far.
let package = Package(
    name: "NoteatoAgent",
    platforms: [.macOS(.v14)],
    dependencies: [
        // Swift-native Parakeet on the Apple Neural Engine (Apache 2.0).
        // Chosen over parakeet-mlx because that path is Python, and a Python
        // runtime cannot live inside a process capped at 150 MB resident.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.12.4")
    ],
    targets: [
        .target(
            name: "AgentCore",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]
        ),
        .executableTarget(
            name: "NoteatoAgent",
            dependencies: ["AgentCore"],
            // Info.plist is a resource of the target only so SwiftPM doesn't
            // warn about it; what actually matters is the linker flag below,
            // which embeds it in the binary's __TEXT,__info_plist section.
            // macOS reads NSMicrophoneUsageDescription from there, and without
            // it the process is killed on its first microphone request rather
            // than prompting the user.
            exclude: ["Info.plist"],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Sources/NoteatoAgent/Info.plist"
                ])
            ]
        ),
        // The §10 hotkey→HUD gate. Lives in this package so that Phase 1 can
        // point it at the agent's real HUD instead of measuring a replica.
        .executableTarget(name: "PanelBench", dependencies: ["AgentCore"]),
        // Diagnostic for the capture path against the real microphone: the
        // failures that matter here (permission, device sample rate, encoder)
        // are environmental and invisible to unit tests. Shares the agent's
        // Info.plist so it can ask for the mic at all.
        // Transcribes one capture and exits. A separate process because the
        // model peaks near the agent's whole memory budget — see Transcriber.
        .executableTarget(name: "NoteatoTranscribe", dependencies: ["AgentCore"]),
        // Measures the transcription engine on *this* machine before anything
        // depends on it: the vendor's realtime figure is an M4 Pro number on
        // their audio, and §6 asks for latency-per-accuracy, not a claim.
        .executableTarget(
            name: "AsrBench",
            dependencies: ["AgentCore"],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Sources/NoteatoAgent/Info.plist"
                ])
            ]
        ),
        .executableTarget(
            name: "CaptureProbe",
            dependencies: ["AgentCore"],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "Sources/NoteatoAgent/Info.plist"
                ])
            ]
        ),
        .testTarget(name: "AgentCoreTests", dependencies: ["AgentCore"])
    ]
)
