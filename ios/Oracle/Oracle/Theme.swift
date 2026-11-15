import SwiftUI

/// Oracle's illustrated look: warm cream paper, pink dots, charcoal outlines and solid offset shadows.
enum Ink {
    static let cream = Color(red: 1.0, green: 0.965, blue: 0.925)
    static let paper = Color.white
    static let charcoal = Color(red: 0.13, green: 0.13, blue: 0.15)
    static let muted = Color(red: 0.36, green: 0.34, blue: 0.38)
    static let dot = Color(red: 0.95, green: 0.66, blue: 0.75)
    static let pink = Color(red: 0.97, green: 0.62, blue: 0.72)
    static let pinkSoft = Color(red: 0.99, green: 0.87, blue: 0.91)
    static let periwinkle = Color(red: 0.62, green: 0.69, blue: 0.96)
    static let periSoft = Color(red: 0.84, green: 0.87, blue: 0.98)
    static let butter = Color(red: 0.99, green: 0.85, blue: 0.42)
    static let butterSoft = Color(red: 1.0, green: 0.94, blue: 0.75)
    static let mint = Color(red: 0.58, green: 0.86, blue: 0.67)
    static let mintSoft = Color(red: 0.85, green: 0.96, blue: 0.88)
    static let blue = Color(red: 0.19, green: 0.32, blue: 0.84)
    static let danger = Color(red: 0.86, green: 0.27, blue: 0.3)
    static let line: CGFloat = 2.5
}

extension Font {
    static func display(_ style: Font.TextStyle) -> Font { .system(style, design: .rounded, weight: .black) }
    static func bold(_ style: Font.TextStyle) -> Font { .system(style, design: .rounded, weight: .bold) }
    static func soft(_ style: Font.TextStyle) -> Font { .system(style, design: .rounded, weight: .medium) }
}

/// Cream paper with a subtle grid of pink dots.
struct DotBackground: View {
    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 22
            var y: CGFloat = 8
            var row = 0
            while y < size.height {
                var x: CGFloat = row.isMultiple(of: 2) ? 8 : 8 + step / 2
                while x < size.width {
                    context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 3, height: 3)), with: .color(Ink.dot.opacity(0.45)))
                    x += step
                }
                y += step
                row += 1
            }
        }
        .background(Ink.cream)
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// White rounded card with a thick outline and a solid offset shadow.
struct InkCard: ViewModifier {
    var fill: Color = Ink.paper
    var radius: CGFloat = 22
    var shadow: CGFloat = 5
    var padding: CGFloat = 16
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: Ink.line))
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Ink.charcoal).offset(x: shadow, y: shadow))
            .padding(.trailing, shadow).padding(.bottom, shadow)
    }
}

extension View {
    func inkCard(fill: Color = Ink.paper, radius: CGFloat = 22, shadow: CGFloat = 5, padding: CGFloat = 16) -> some View {
        modifier(InkCard(fill: fill, radius: radius, shadow: shadow, padding: padding))
    }
    /// Outline only (no shadow) for small elements.
    func inkOutline(_ radius: CGFloat = 14, fill: Color = Ink.paper, line: CGFloat = 2) -> some View {
        background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: line))
    }
}

/// A card with a colored label strip on top, like a sticker.
struct TagCard<Content: View>: View {
    let tag: String
    var color: Color = Ink.pink
    var shadow: CGFloat = 5
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(tag.uppercased())
                .font(.system(.caption, design: .rounded, weight: .heavy)).tracking(0.6)
                .foregroundStyle(Ink.charcoal)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(color)
                .overlay(alignment: .bottom) { Rectangle().fill(Ink.charcoal).frame(height: Ink.line) }
            content
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Ink.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: Ink.line))
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Ink.charcoal).offset(x: shadow, y: shadow))
        .padding(.trailing, shadow).padding(.bottom, shadow)
    }
}

/// Chunky button whose face presses down onto its shadow.
struct ChunkyButtonStyle: ButtonStyle {
    var fill: Color = Ink.blue
    var text: Color = .white
    var radius: CGFloat = 18
    var height: CGFloat = 52
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed && enabled
        configuration.label
            .font(.system(.headline, design: .rounded, weight: .heavy))
            .foregroundStyle(enabled ? text : Ink.muted)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .frame(minHeight: height)
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(enabled ? fill : Color(white: 0.88)))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: Ink.line))
            .offset(x: pressed ? 3 : 0, y: pressed ? 3 : 0)
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Ink.charcoal).offset(x: 4, y: 4))
            .padding(.trailing, 4).padding(.bottom, 4)
            .contentShape(Rectangle())
            .animation(reduceMotion ? nil : .spring(duration: 0.14), value: pressed)
    }
}

extension ButtonStyle where Self == ChunkyButtonStyle {
    static var chunky: ChunkyButtonStyle { ChunkyButtonStyle() }
    static func chunky(_ fill: Color, text: Color = Ink.charcoal, height: CGFloat = 52) -> ChunkyButtonStyle {
        ChunkyButtonStyle(fill: fill, text: text, height: height)
    }
}

/// Small pressed-state style for icon buttons and rows.
struct SquishStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct Chip: View {
    let text: String
    var symbol: String?
    var fill: Color = Ink.paper
    var body: some View {
        HStack(spacing: 5) {
            if let symbol { Image(systemName: symbol).font(.caption.weight(.bold)) }
            Text(text).font(.system(.caption, design: .rounded, weight: .heavy)).lineLimit(1)
        }
        .foregroundStyle(Ink.charcoal)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Capsule().fill(fill))
        .overlay(Capsule().strokeBorder(Ink.charcoal, lineWidth: 2))
    }
}

struct IconBadge: View {
    let symbol: String
    var fill: Color = Ink.butter
    var size: CGFloat = 40
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.42, weight: .bold))
            .foregroundStyle(Ink.charcoal)
            .frame(width: size, height: size)
            .inkOutline(size * 0.32, fill: fill)
            .accessibilityHidden(true)
    }
}

struct SectionTitle: View {
    let text: String
    var trailing: String?
    var action: (() -> Void)?
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text).font(.display(.title3)).foregroundStyle(Ink.charcoal)
            Spacer()
            if let trailing, let action {
                Button(trailing, action: action).font(.bold(.subheadline)).foregroundStyle(Ink.blue).frame(minHeight: 44)
            }
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// Speech bubble with a tail pointing left, toward Ora.
struct BubbleShape: Shape {
    var radius: CGFloat = 18
    var tail: CGFloat = 12
    var tailY: CGFloat = 26
    func path(in rect: CGRect) -> Path {
        let r = min(radius, rect.height / 2)
        let left = rect.minX + tail
        let ty = min(max(tailY, r + tail), rect.maxY - r - tail)
        var p = Path()
        p.move(to: CGPoint(x: left + r, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        p.addArc(center: CGPoint(x: rect.maxX - r, y: rect.minY + r), radius: r, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addArc(center: CGPoint(x: rect.maxX - r, y: rect.maxY - r), radius: r, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: left + r, y: rect.maxY))
        p.addArc(center: CGPoint(x: left + r, y: rect.maxY - r), radius: r, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        p.addLine(to: CGPoint(x: left, y: ty + tail * 0.7))
        p.addLine(to: CGPoint(x: rect.minX, y: ty))
        p.addLine(to: CGPoint(x: left, y: ty - tail * 0.7))
        p.addLine(to: CGPoint(x: left, y: rect.minY + r))
        p.addArc(center: CGPoint(x: left + r, y: rect.minY + r), radius: r, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.closeSubpath()
        return p
    }
}

struct SpeechBubble: View {
    let title: String
    var message: String?
    var fill: Color = Ink.paper
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.display(.headline)).foregroundStyle(Ink.charcoal)
            if let message {
                Text(message).font(.soft(.subheadline)).foregroundStyle(Ink.charcoal)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.leading, 26).padding(.trailing, 14).padding(.vertical, 12)
        .background(BubbleShape().fill(fill))
        .overlay(BubbleShape().stroke(Ink.charcoal, style: StrokeStyle(lineWidth: Ink.line, lineJoin: .round)))
        .background(BubbleShape().fill(Ink.charcoal).offset(x: 4, y: 4))
        .accessibilityElement(children: .combine)
    }
}

/// Ora on a periwinkle blob, floating gently, with a speech bubble.
struct OraHero: View {
    let title: String
    var message: String?
    var oraSize: CGFloat = 120
    @State private var reaction = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        // Large accessibility text: Ora above the bubble so the message keeps a readable width.
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .center, spacing: 4))
        layout {
            Button { reaction += 1; AppSounds.shared.play(.hello) } label: {
                ZStack {
                    Ellipse().fill(Ink.periSoft)
                        .frame(width: oraSize * 1.05, height: oraSize * 0.9)
                        .offset(y: oraSize * 0.12)
                    OraPortrait(animated: !reduceMotion && phase == .active, reaction: reaction)
                        .frame(width: oraSize, height: oraSize * 1.2)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Wave to Ora")
            FloatingBubble(title: title, message: message, animated: !reduceMotion && phase == .active)
        }
    }
}

private struct FloatingBubble: View {
    let title: String
    let message: String?
    let animated: Bool
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !animated)) { tick in
            let t = tick.date.timeIntervalSinceReferenceDate
            SpeechBubble(title: title, message: message)
                .offset(y: animated ? sin(t * 1.6 + 1) * 3 : 0)
        }
    }
}

/// Inline, screen-scoped notice with an optional action (for example Retry or Sign in).
struct NoticeCard: View {
    enum Kind { case error, info, success, sample }
    let kind: Kind
    let title: String
    var message: String?
    var actionTitle: String?
    var action: (() -> Void)?
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconBadge(symbol: symbol, fill: fill, size: 36)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                if let message { Text(message).font(.soft(.subheadline)).foregroundStyle(Ink.muted).fixedSize(horizontal: false, vertical: true) }
                if let actionTitle, let action {
                    Button(actionTitle, action: action).buttonStyle(.chunky(fill, height: 40)).padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
        }
        .inkCard(fill: Ink.paper, shadow: 4, padding: 14)
        .accessibilityElement(children: .contain)
    }
    private var symbol: String {
        switch kind { case .error: "exclamationmark.triangle.fill"; case .info: "info"; case .success: "checkmark"; case .sample: "sparkles" }
    }
    private var fill: Color {
        switch kind { case .error: Ink.pink; case .info: Ink.periwinkle; case .success: Ink.mint; case .sample: Ink.butter }
    }
}

struct OracleWordmark: View {
    var body: some View {
        HStack(spacing: 8) {
            Image("OracleMark")
                .resizable().scaledToFit()
                .frame(width: 34, height: 34)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Ink.charcoal, lineWidth: 2))
                .accessibilityHidden(true)
            Text("Oracle").font(.display(.title3)).foregroundStyle(Ink.charcoal)
                .lineLimit(1).fixedSize()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Oracle")
    }
}

/// Text field styled as an outlined pill.
struct InkField: View {
    let title: String
    @Binding var text: String
    var symbol: String?
    var secure = false
    var body: some View {
        HStack(spacing: 10) {
            if let symbol { Image(systemName: symbol).foregroundStyle(Ink.charcoal).accessibilityHidden(true) }
            Group {
                if secure { SecureField(title, text: $text) } else { TextField(title, text: $text) }
            }
            .font(.soft(.body))
            .foregroundStyle(Ink.charcoal)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 50)
        .inkOutline(14)
    }
}
