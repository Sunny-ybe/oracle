import SwiftUI
import ImageIO

enum OraArtwork {
    static let bitmap: CGImage? = {
        guard let url = Bundle.main.url(forResource: "OraArt", withExtension: "png"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }()

    static var image: Image {
        guard let bitmap else { return Image("OraArt.png") }
        return Image(decorative: bitmap, scale: 1)
    }
}

/// Animate the original artwork in image coordinates, independent of the display size.
struct OraPortrait: View {
    let animated: Bool
    let reaction: Int
    @State private var waveStart = Date()

    var body: some View {
        ZStack {
            OraArtwork.image.resizable().scaledToFit()
                .padding(.vertical, 5)
                .opacity(animated && OraArtwork.bitmap != nil ? 0 : 1)
            if animated, OraArtwork.bitmap != nil {
                animatedPortrait
            }
        }
        .onChange(of: reaction) { _, _ in waveStart = Date() }
        .accessibilityHidden(true)
    }

    private var animatedPortrait: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animated)) { tick in
            let time = tick.date.timeIntervalSinceReferenceDate
            let age = max(0, tick.date.timeIntervalSince(waveStart))
            let wave = animated && age < 1.15 ? sin(age * 17) * sin(.pi * age / 1.15) : 0
            let blinkTime = time.truncatingRemainder(dividingBy: 4.9)
            let blink = animated && blinkTime < 0.16 ? sin(.pi * blinkTime / 0.16) : 0

            Canvas { context, size in
                let scale = min(size.width * 0.92 / 1124, size.height * 0.95 / 1399)
                guard scale > 0 else { return }
                let image = context.resolve(OraArtwork.image.renderingMode(.original))
                let bounds = CGRect(x: 0, y: 0, width: 1124, height: 1399)
                context.translateBy(x: size.width / 2, y: size.height / 2 + (animated ? 3 * sin(time * 1.8) : 0))
                context.rotate(by: .radians(animated ? sin(time * 1.4) * 0.017 : 0))
                context.scaleBy(x: scale, y: scale)
                context.translateBy(x: -bounds.midX, y: -bounds.midY)

                // The mitten sits outside the body on this side of the shoulder.
                let mitten = Path { path in
                    path.move(to: CGPoint(x: 815, y: 735))
                    path.addLine(to: CGPoint(x: 975, y: 557))
                    path.addLine(to: CGPoint(x: 1124, y: 550))
                    path.addLine(to: CGPoint(x: 1124, y: 930))
                    path.addLine(to: CGPoint(x: 811, y: 930))
                    path.closeSubpath()
                }
                var base = context
                if wave != 0 { base.clip(to: mitten, options: .inverse) }
                base.draw(image, in: bounds)
                if wave != 0 {
                    var hand = context
                    hand.translateBy(x: 815, y: 784)
                    hand.rotate(by: .degrees(wave * 4))
                    hand.translateBy(x: -815, y: -784)
                    hand.clip(to: mitten)
                    hand.draw(image, in: bounds)
                }
                if blink > 0 {
                    // Fade the visor smoothly around each LED before compressing the smile.
                    for eye in [CGRect(x: 335,y: 380,width: 218,height: 170),
                                CGRect(x: 650,y: 302,width: 210,height: 160)] {
                        let center = CGPoint(x:eye.midX,y:eye.midY)
                        var lid = context
                        lid.opacity = blink
                        lid.clipToLayer { mask in
                            mask.fill(Path(ellipseIn:eye.insetBy(dx:-18,dy:-18)),
                                      with:.radialGradient(Gradient(colors:[.white,.white,.clear]),center:center,startRadius:eye.height*0.38,endRadius:eye.width*0.62))
                        }
                        lid.fill(Path(eye.insetBy(dx:-20,dy:-20)),with:.color(Color(white:0.155)))
                        lid.translateBy(x:0,y:eye.maxY)
                        lid.scaleBy(x:1,y:1 - blink * 0.82)
                        lid.translateBy(x:0,y:-eye.maxY)
                        lid.clip(to:Path(ellipseIn:eye))
                        lid.draw(image,in:bounds)
                    }
                }
            }
        }
    }
}
