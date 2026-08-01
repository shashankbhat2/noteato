import AppKit
import Foundation

/// Launches the Electron library on demand.
///
/// The agent ships inside the app bundle as
/// `Noteato.app/Contents/Resources/NoteatoAgent`, so the bundle to open is
/// three directories up. In development there is no bundle, and
/// `NOTEATO_LIBRARY_CMD` points at whatever `electron-vite dev` is running.
@MainActor
final class LibraryLauncher {
    /// The `.app` this agent is embedded in, or nil when running from a build
    /// directory rather than a bundle.
    private var hostBundleURL: URL? {
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        // …/Noteato.app/Contents/Resources/NoteatoAgent
        let contents = executable.deletingLastPathComponent().deletingLastPathComponent()
        let app = contents.deletingLastPathComponent()
        guard app.pathExtension == "app",
            FileManager.default.fileExists(atPath: app.appendingPathComponent("Contents").path)
        else { return nil }
        return app
    }

    func launch() {
        if let devCommand = ProcessInfo.processInfo.environment["NOTEATO_LIBRARY_CMD"] {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/sh")
            process.arguments = ["-c", devCommand]
            try? process.run()
            return
        }

        guard let app = hostBundleURL else {
            FileHandle.standardError.write(
                Data("NoteatoAgent: no host bundle; set NOTEATO_LIBRARY_CMD in dev\n".utf8))
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: app, configuration: configuration)
    }
}
