import AppKit
import QuartzCore

/// The capture HUD: a borderless floating panel, centred, over fullscreen apps.
///
/// §4.1 of the revamp brief is a constraint on what this may contain, not just
/// how it looks — live waveform, elapsed timer, nothing else. No title field, no
/// folder picker, no tags. Every field at capture time is a decision made while
/// holding a thought.
///
/// It lives in AgentCore rather than in the executable so `PanelBench` measures
/// this exact type. A latency gate against a replica measures the replica.
@MainActor
public final class CaptureHUD {
    public static let size = NSSize(width: 420, height: 90)

    private let panel: NSPanel
    private let content: HUDContentView

    public init() {
        panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: CaptureHUD.size),
            // .nonactivatingPanel is what lets capture start without stealing
            // focus from whatever the user was typing in.
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.hasShadow = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.isMovable = false
        panel.hidesOnDeactivate = false

        content = HUDContentView(frame: NSRect(origin: .zero, size: CaptureHUD.size))
        panel.contentView = content
    }

    public var isVisible: Bool { panel.isVisible }

    /// Centre horizontally, and a third of the way up — a panel dead-centre sits
    /// on top of whatever the user is looking at.
    private func position() {
        guard let screen = NSScreen.main else { return }
        let frame = screen.visibleFrame
        panel.setFrameOrigin(
            NSPoint(
                x: frame.midX - CaptureHUD.size.width / 2,
                y: frame.minY + frame.height * 0.32
            ))
    }

    public func show() {
        position()
        content.startTimer()
        // orderFrontRegardless, not makeKeyAndOrderFront: the HUD must appear
        // over fullscreen apps without activating this process.
        panel.orderFrontRegardless()
    }

    public func hide() {
        content.stopTimer()
        panel.orderOut(nil)
    }

    public func toggle() {
        if panel.isVisible { hide() } else { show() }
    }

    /// Feed levels in 0…1. Phase 2 wires this to the ring buffer's tap; until
    /// then the waveform renders an idle baseline.
    public func setLevel(_ level: CGFloat) {
        content.level = max(0, min(1, level))
    }
}

/// Draws the rounded card, the waveform and the elapsed timer. Drawn rather than
/// composed from subviews so the whole HUD is one layer to present — the 80 ms
/// budget is spent before this runs, but there is no reason to spend more.
final class HUDContentView: NSView {
    var level: CGFloat = 0 {
        didSet { needsDisplay = true }
    }

    private var startedAt: CFTimeInterval?
    private var timer: Timer?
    private var phase: CGFloat = 0

    override var isFlipped: Bool { false }

    func startTimer() {
        startedAt = CACurrentMediaTime()
        timer?.invalidate()
        // 20 Hz: enough for a waveform to read as live, cheap enough that the
        // agent's idle CPU budget survives a long capture.
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.phase += 0.28
                self.needsDisplay = true
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func stopTimer() {
        timer?.invalidate()
        timer = nil
        startedAt = nil
    }

    private func elapsedText() -> String {
        guard let startedAt else { return "0:00" }
        let seconds = Int(CACurrentMediaTime() - startedAt)
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    override func draw(_ dirtyRect: NSRect) {
        let card = bounds.insetBy(dx: 6, dy: 6)
        let radius: CGFloat = 18

        NSColor(calibratedWhite: 0.08, alpha: 0.96).setFill()
        NSBezierPath(roundedRect: card, xRadius: radius, yRadius: radius).fill()
        NSColor(calibratedWhite: 1, alpha: 0.10).setStroke()
        let border = NSBezierPath(roundedRect: card.insetBy(dx: 0.5, dy: 0.5), xRadius: radius, yRadius: radius)
        border.lineWidth = 1
        border.stroke()

        // Elapsed time, trailing.
        let timeText = elapsedText() as NSString
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .medium),
            .foregroundColor: NSColor(calibratedWhite: 0.62, alpha: 1)
        ]
        let timeSize = timeText.size(withAttributes: attributes)
        timeText.draw(
            at: NSPoint(x: card.maxX - timeSize.width - 20, y: card.midY - timeSize.height / 2),
            withAttributes: attributes)

        // Waveform, filling the space left of the timer.
        let waveRect = NSRect(
            x: card.minX + 20,
            y: card.midY - 15,
            width: card.width - timeSize.width - 56,
            height: 30
        )
        drawWaveform(in: waveRect)
    }

    private func drawWaveform(in rect: NSRect) {
        let bars = 56
        let spacing: CGFloat = 3
        let barWidth = max(1, (rect.width - spacing * CGFloat(bars - 1)) / CGFloat(bars))
        NSColor(calibratedWhite: 0.92, alpha: 1).setFill()

        for i in 0..<bars {
            // An idle baseline that still moves, so a live mic never looks
            // frozen; amplitude rides on the measured level once wired.
            let wobble = abs(sin(phase + CGFloat(i) * 0.36))
            let amplitude = 0.10 + (0.14 + 0.76 * level) * wobble
            let height = max(2, rect.height * amplitude)
            let x = rect.minX + CGFloat(i) * (barWidth + spacing)
            let bar = NSRect(x: x, y: rect.midY - height / 2, width: barWidth, height: height)
            NSBezierPath(roundedRect: bar, xRadius: barWidth / 2, yRadius: barWidth / 2).fill()
        }
    }
}
