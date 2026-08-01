// §10 gate: "Hotkey → HUD visible — under 80 ms".
//
//   swift run -c release PanelBench [--budget 80] [--iterations 20] [--gate] [--json]
//
// Measures AgentCore.CaptureHUD — the real type the agent shows, not a replica.
// That is the whole reason this benchmark is a target in this package.
//
// What this does NOT measure: the hotkey dispatch itself. RegisterEventHotKey
// delivery was measured at well under a millisecond during the Phase 0 audit,
// so the panel is the term that matters. If that assumption ever stops holding,
// this benchmark will quietly under-report.
import AgentCore
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

    // Cold: construction plus first show, paying AppKit's one-time warm-up.
    // This is the path a user hits on the first capture after login.
    let coldStart = CACurrentMediaTime()
    let hud = CaptureHUD()
    hud.show()
    CATransaction.flush()
    let coldMs = ms(coldStart)

    // Warm: every subsequent capture, with the HUD already constructed.
    var warm: [Double] = []
    for _ in 0..<args.iterations {
        hud.hide()
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        let start = CACurrentMediaTime()
        hud.show()
        CATransaction.flush()
        warm.append(ms(start))
        RunLoop.current.run(until: Date().addingTimeInterval(0.03))
    }
    hud.hide()
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
        print("hotkey → HUD · CaptureHUD · \(args.iterations) warm iterations")
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
