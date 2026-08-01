import AgentCore
import Foundation

// Placeholder entry point. Phase 1 replaces this with the menu-bar process:
// NSStatusItem, RegisterEventHotKey, the HUD panel, and the socket server.
// It exists now so CI builds and links the executable target.
let version = "0.0.0-phase0.5"
FileHandle.standardOutput.write(Data("NoteatoAgent \(version)\n".utf8))
