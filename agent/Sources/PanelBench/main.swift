// §10 gate: "Hotkey → HUD visible — under 80 ms".
//
//   swift run -c release PanelBench [--budget 80] [--iterations 20] [--gate] [--json]
//
// Phase 0.5 measures the AppKit primitive: a borderless non-activating NSPanel
// of the HUD's size and level. Phase 1 must repoint this at the agent's real
// HUD type — it lives in this package so it can import it directly, which is
// the whole reason the benchmark is a target here rather than a replica in
// bench/.
//
// What this does NOT measure: the hotkey dispatch itself. RegisterEventHotKey
// delivery was measured at well under a millisecond during the Phase 0 audit,
// so the panel is the term that matters. If that assumption ever stops holding,
// this benchmark will quietly under-report.
import AppKit
import QuartzCore

struct Args {
    let budgetMs: Double
    let iterations: Int
    let gate: Bool
    let json: Bool

    init(_ argv: [String]) {
        func value(_ name: String, _ fallback: Double) -> Double {
            guard let i = argv.firstIndex(of: "--\(name)"), i + 1 < argv.count else { return fallback }
            return Double(argv[i + 1]) ?? fallback
        }
        budgetMs = value("budget", 80)
        iterations = Int(value("iterations", 20))
        gate = argv.contains("--gate")
        json = argv.contains("--json")
    }
}

/// A 64-bar waveform, so the panel is doing the HUD's real per-frame drawing
/// rather than presenting an empty surface.
final class WaveformView: NSView {
    override var isOpaque: Bool { true }
    override func draw(_ dirty: NSRect) {
        NSColor(white: 0.1, alpha: 1).setFill()
        dirty.fill()
        NSColor.white.setFill()
        let bars = 64
        let w = bounds.width / CGFloat(bars)
        for i in 0..<bars {
            let h = bounds.height * (0.15 + 0.7 * abs(sin(CGFloat(i) * 0.4)))
            NSRect(x: CGFloat(i) * w, y: (bounds.height - h) / 2, width: w * 0.6, height: h).fill()
        }
    }
}

@MainActor
func makeHUD() -> NSPanel {
    let panel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 420, height: 90),
        styleMask: [.borderless, .nonactivatingPanel],
        backing: .buffered,
        defer: false
    )
    panel.isFloatingPanel = true
    panel.level = .statusBar
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.hasShadow = true
    panel.isOpaque = true
    panel.backgroundColor = NSColor(white: 0.1, alpha: 1)
    panel.contentView = WaveformView(frame: NSRect(x: 0, y: 0, width: 420, height: 90))
    if let screen = NSScreen.main {
        panel.setFrameOrigin(NSPoint(x: screen.frame.midX - 210, y: screen.frame.midY - 45))
    }
    return panel
}

func ms(_ from: CFTimeInterval) -> Double { (CACurrentMediaTime() - from) * 1000 }

func round(_ v: Double, _ places: Int = 2) -> Double {
    let f = pow(10, Double(places))
    return (v * f).rounded() / f
}

func residentMB() -> Double {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(
        MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
    let kerr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
    }
    return kerr == KERN_SUCCESS ? Double(info.resident_size) / 1_048_576.0 : 0
}

@MainActor
func run(_ args: Args) -> Never {
    NSApplication.shared.setActivationPolicy(.accessory)

    // Cold: first construction pays AppKit's one-time warm-up as well as the panel's.
    let coldStart = CACurrentMediaTime()
    let panel = makeHUD()
    panel.orderFrontRegardless()
    CATransaction.flush()
    let coldMs = ms(coldStart)

    // Warm: the case a user actually hits — the panel exists, hidden, and is shown.
    var warm: [Double] = []
    for _ in 0..<args.iterations {
        panel.orderOut(nil)
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        let start = CACurrentMediaTime()
        panel.orderFrontRegardless()
        CATransaction.flush()
        warm.append(ms(start))
        RunLoop.current.run(until: Date().addingTimeInterval(0.03))
    }
    panel.orderOut(nil)
    warm.sort()

    let median = warm[warm.count / 2]
    let p95 = warm[min(warm.count - 1, Int(Double(warm.count) * 0.95))]
    let rss = residentMB()

    // The gate is the cold path: it is the slower of the two and the one a user
    // hits on the first capture after launch, which is the one that forms the
    // impression the 80 ms budget exists to protect.
    let withinBudget = coldMs <= args.budgetMs && p95 <= args.budgetMs

    if args.json {
        let payload: [String: Any] = [
            "metric": "hotkey-to-hud",
            "budgetMs": args.budgetMs,
            "coldMs": round(coldMs),
            "warmMedianMs": round(median),
            "warmP95Ms": round(p95),
            "warmMaxMs": round(warm.last ?? 0),
            "residentMB": round(rss, 1),
            "iterations": args.iterations,
            "withinBudget": withinBudget
        ]
        let data = try! JSONSerialization.data(
            withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
        print(String(data: data, encoding: .utf8)!)
    } else {
        print("hotkey → HUD · NSPanel 420×90 · \(args.iterations) warm iterations")
        print("  cold (incl. AppKit warm-up)  \(round(coldMs)) ms")
        print("  warm median                  \(round(median)) ms")
        print("  warm p95                     \(round(p95)) ms")
        print("  resident                     \(round(rss, 1)) MB")
        print("  budget \(args.budgetMs) ms — \(withinBudget ? "PASS" : "FAIL")")
    }

    if args.gate && !withinBudget {
        FileHandle.standardError.write(
            Data(
                "\nFAIL: cold \(round(coldMs)) ms / p95 \(round(p95)) ms exceeds the \(args.budgetMs) ms budget (§10).\n"
                    .utf8))
        exit(1)
    }
    exit(0)
}

// Top-level code runs on the main thread, but under Swift 6 isolation checking
// it is not *typed* as main-actor. This is the assertion that says so.
MainActor.assumeIsolated { run(Args(CommandLine.arguments)) }
