import SwiftUI
import MapKit
import AVFoundation

// Contribution moments (measuring noise, earning points, thank-you) in the app's ink style:
// cream dot background, white cards with charcoal outlines and offset shadows, chunky buttons.

/// The Oracle points coin.
struct CoinView: View {
    var size: CGFloat = 80
    var body: some View {
        ZStack {
            Circle().fill(Ink.charcoal).offset(x: size * 0.05, y: size * 0.05)
            Circle().fill(Ink.butter)
            Circle().strokeBorder(Ink.charcoal, lineWidth: max(1.5, size * 0.04))
            Circle().strokeBorder(Ink.charcoal.opacity(0.25), lineWidth: max(1, size * 0.025)).padding(size * 0.14)
            Image(systemName: "asterisk").font(.system(size: size * 0.4, weight: .black))
                .foregroundStyle(Color(red: 1.0, green: 0.45, blue: 0.25))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Noise measurement

enum NoiseLevel: Int, CaseIterable, Identifiable {
    case quiet, moderate, loud
    init(db: Double) { self = db < 50 ? .quiet : (db <= 70 ? .moderate : .loud) }
    var id: Int { rawValue }
    var title: String { ["Quiet", "Moderate", "Loud"][rawValue] }
    var range: String { ["< 50 dB", "50 – 70 dB", "> 70 dB"][rawValue] }
    var tint: Color { [Ink.mint, Ink.butter, Ink.pink][rawValue] }
    var soft: Color { [Ink.mintSoft, Ink.butterSoft, Ink.pinkSoft][rawValue] }
}

/// Records ambient sound for a few seconds and keeps only the loudness. No audio is saved or sent.
@MainActor @Observable final class NoiseMeter {
    enum State: Equatable { case idle, recording, done, denied, failed(String) }
    private(set) var state: State = .idle
    private(set) var db: Double = 0          // live, smoothed
    private(set) var average: Double = 0     // final reading
    private(set) var history: [Double] = []  // 0...1, newest last, for the waveform
    private(set) var elapsed: TimeInterval = 0
    let duration: TimeInterval = 10

    @ObservationIgnored private let soundCaptureID = UUID()
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var samples: [Double] = []
    @ObservationIgnored private var started = Date()

    func start() async {
        guard state != .recording else { return }
        guard await AVAudioApplication.requestRecordPermission() else { state = .denied; return }
        do {
            AppSounds.shared.beginCapture(soundCaptureID)
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement)
            try audio.setActive(true)
            let url = FileManager.default.temporaryDirectory.appending(path: "oracle-noise.caf")
            let r = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatAppleIMA4, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1])
            r.isMeteringEnabled = true
            guard r.record() else { throw CocoaError(.featureUnsupported) }
            recorder = r
            samples = []; history = []; elapsed = 0; db = 0; average = 0; started = .now
            state = .recording
            timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
        } catch {
            AppSounds.shared.endCapture(soundCaptureID)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            state = .failed("The microphone couldn’t start. Try again.")
        }
    }

    private func tick() {
        guard let recorder, state == .recording else { return }
        recorder.updateMeters()
        // averagePower is dBFS (-160...0). Adding ~100 gives a rough sound-level estimate:
        // a quiet room reads ~40-50 dB, conversation ~60-70, a busy cafeteria 75+.
        let level = min(110, max(30, Double(recorder.averagePower(forChannel: 0)) + 100))
        samples.append(level)
        db = db == 0 ? level : db * 0.8 + level * 0.2
        history.append(min(1, max(0.06, (level - 30) / 70)))
        if history.count > 64 { history.removeFirst(history.count - 64) }
        elapsed = Date().timeIntervalSince(started)
        if elapsed >= duration { stop() }
    }

    func stop() {
        AppSounds.shared.endCapture(soundCaptureID)
        guard state == .recording else { return }
        timer?.invalidate(); timer = nil
        recorder?.stop(); recorder?.deleteRecording(); recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        // Average the sound energy (decibels add logarithmically); skip the first quarter second while the mic settles.
        let use = samples.count > 8 ? Array(samples.dropFirst(5)) : samples
        guard !use.isEmpty else { state = .failed("No sound was captured. Try again."); return }
        let energy = use.map { pow(10, $0 / 10) }.reduce(0, +) / Double(use.count)
        average = (10 * log10(energy)).rounded()
        state = .done
    }

    func reset() {
        stop()
        state = .idle; history = []; db = 0; average = 0; elapsed = 0
    }
}

/// Symmetric bars that react to the live level.
struct Waveform: View {
    let levels: [Double]
    var bars = 40
    var spacing: CGFloat = 3
    var color: Color = Ink.charcoal
    var body: some View {
        GeometryReader { g in
            let recent = Array(levels.suffix(bars))
            let values = Array(repeating: 0.06, count: max(0, bars - recent.count)) + recent
            HStack(alignment: .center, spacing: spacing) {
                ForEach(values.indices, id: \.self) { i in
                    Capsule().fill(color.opacity(0.35 + 0.65 * values[i]))
                        .frame(height: max(3, g.size.height * values[i]))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .animation(.linear(duration: 0.05), value: levels.count)
        .accessibilityHidden(true)
    }
}

struct MeasureNoiseScreen: View {
    let placeName: String
    var onUse: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var meter = NoiseMeter()

    private var shown: Double { meter.state == .done ? meter.average : meter.db }
    private var level: NoiseLevel? { shown > 0 ? NoiseLevel(db: shown) : nil }
    private var recording: Bool { meter.state == .recording }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    gaugeCard
                    levels
                    controls
                }
                .padding(20)
                .frame(maxWidth: 600).frame(maxWidth: .infinity)
            }
            .background(DotBackground())
            .navigationTitle("Measure noise")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.font(.bold(.body)) } }
        }
        .onDisappear { meter.stop() }
    }

    private var gaugeCard: some View {
        let progress = min(1, max(0, (shown - 30) / 80))
        let tint = level?.tint ?? Ink.periwinkle
        return TagCard(tag: placeName, color: level?.tint ?? Ink.butter) {
            VStack(spacing: 14) {
                ZStack {
                    Circle().trim(from: 0, to: 0.75)
                        .stroke(Ink.charcoal.opacity(0.08), style: StrokeStyle(lineWidth: 18, lineCap: .round))
                        .rotationEffect(.degrees(135))
                    Circle().trim(from: 0, to: 0.75 * progress)
                        .stroke(tint, style: StrokeStyle(lineWidth: 18, lineCap: .round))
                        .rotationEffect(.degrees(135))
                        .animation(.easeOut(duration: 0.15), value: progress)
                    Circle().trim(from: 0, to: 0.75 * progress)
                        .stroke(Ink.charcoal, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .padding(-9).rotationEffect(.degrees(135)).opacity(progress > 0 ? 1 : 0)
                    VStack(spacing: 6) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(shown > 0 ? "\(Int(shown))" : "--")
                                .font(.system(size: 60, weight: .black, design: .rounded)).monospacedDigit()
                                .contentTransition(.numericText())
                            Text("dB").font(.bold(.title3)).foregroundStyle(Ink.muted)
                        }
                        .foregroundStyle(Ink.charcoal)
                        Chip(text: level?.title ?? "Ready", symbol: "waveform", fill: level?.soft ?? Ink.periSoft)
                    }
                }
                .frame(width: 220, height: 220)
                .frame(maxWidth: .infinity)
                Waveform(levels: meter.history).frame(height: 54)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(shown > 0 ? "\(Int(shown)) decibels, \(level?.title ?? "")" : "No reading yet")
    }

    private var levels: some View {
        HStack(spacing: 8) {
            ForEach(NoiseLevel.allCases) { l in
                let on = level == l
                VStack(spacing: 2) {
                    Text(l.title).font(.bold(.subheadline))
                    Text(l.range).font(.soft(.caption2))
                }
                .foregroundStyle(Ink.charcoal)
                .frame(maxWidth: .infinity).padding(.vertical, 10)
                .inkOutline(14, fill: on ? l.tint : Ink.paper, line: on ? 2.5 : 1.5)
            }
        }
        .animation(.easeOut(duration: 0.2), value: level)
    }

    @ViewBuilder private var controls: some View {
        if meter.state == .done {
            VStack(spacing: 10) {
                Button { onUse(Int(meter.average)); dismiss() } label: { Text("Use \(Int(meter.average)) dB reading").frame(maxWidth: .infinity) }
                    .buttonStyle(.chunky(Ink.blue, text: .white))
                    .accessibilityIdentifier("useNoiseReading")
                Button { meter.reset(); Task { await meter.start() } } label: { Text("Measure again").frame(maxWidth: .infinity) }
                    .buttonStyle(.chunky(Ink.paper, height: 46))
            }
        } else {
            VStack(spacing: 10) {
                Button { if recording { meter.stop() } else { Task { await meter.start() } } } label: {
                    ZStack {
                        Circle().fill(Ink.charcoal).offset(x: 4, y: 4)
                        Circle().fill(recording ? Ink.pink : Ink.butter)
                        Circle().strokeBorder(Ink.charcoal, lineWidth: Ink.line)
                        Image(systemName: recording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 28, weight: .black)).foregroundStyle(Ink.charcoal)
                    }
                    .frame(width: 80, height: 80)
                }
                .buttonStyle(SquishStyle())
                .accessibilityLabel(recording ? "Stop recording" : "Start recording")
                Text(String(format: "00:%02d", Int(meter.elapsed))).font(.bold(.headline)).monospacedDigit().foregroundStyle(Ink.charcoal)
                Text(statusText).font(.soft(.subheadline)).foregroundStyle(Ink.muted).multilineTextAlignment(.center)
            }
            .padding(.top, 4)
        }
    }

    private var statusText: String {
        switch meter.state {
        case .idle: "Tap the mic to record 10 seconds of ambient noise. Only the dB number leaves your phone."
        case .recording: "Recording ambient noise…"
        case .denied: "Microphone access is off. Allow it in Settings → Oracle."
        case .failed(let message): message
        case .done: ""
        }
    }
}

// MARK: - Wi-Fi speed test

enum WifiLevel: Int, CaseIterable, Identifiable {
    case slow, okay, fast
    init(mbps: Double) { self = mbps < 10 ? .slow : (mbps <= 50 ? .okay : .fast) }
    var id: Int { rawValue }
    var title: String { ["Slow", "Okay", "Fast"][rawValue] }
    var soft: Color { [Ink.pinkSoft, Ink.butterSoft, Ink.mintSoft][rawValue] }
}

/// Downloads the server's 1 MB test file twice and keeps the faster run, like the web app.
/// It measures this iPhone's current connection to the Oracle server (Wi-Fi or mobile data).
@MainActor enum SpeedTest {
    static func run(session: OracleSession) async throws -> Double {
        var best = 0.0
        for _ in 0..<2 {
            // A random query string and no local cache, so every run is a real download.
            guard let url = session.absoluteURL("/speedtest.bin?r=\(Double.random(in: 0..<1))") else { throw APIError.notConfigured }
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 30)
            request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            let started = Date()
            let (data, response) = try await URLSession.shared.data(for: request)
            let seconds = Date().timeIntervalSince(started)
            guard (response as? HTTPURLResponse)?.statusCode == 200, !data.isEmpty, seconds > 0 else { throw APIError.badResponse }
            best = max(best, Double(data.count) * 8 / seconds / 1e6)
        }
        return (best * 10).rounded() / 10
    }
}

// MARK: - Earnings (kept on this iPhone for the Rewards summary)

struct EarningEntry: Codable, Identifiable {
    var id = UUID()
    let title: String
    let points: Int
    let at: Date
}

enum EarningsLog {
    private static let key = "oracle.earnings"
    static func all() -> [EarningEntry] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([EarningEntry].self, from: data)) ?? []
    }
    static func add(_ entry: EarningEntry) {
        let list = Array(([entry] + all()).prefix(100))
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: key) }
    }
    static var today: [EarningEntry] { all().filter { Calendar.current.isDateInToday($0.at) } }
    /// Consecutive days, ending today, with at least one contribution.
    static var streakDays: Int {
        let cal = Calendar.current
        let days = Set(all().map { cal.startOfDay(for: $0.at) })
        var day = cal.startOfDay(for: .now), count = 0
        while days.contains(day) { count += 1; day = cal.date(byAdding: .day, value: -1, to: day) ?? day.addingTimeInterval(-86_400) }
        return count
    }
}

/// "Today" summary on the Rewards tab (signed in only).
struct PointsEarnedCard: View {
    let entries: [EarningEntry]
    let streak: Int
    var onRedeem: () -> Void
    private var total: Int { entries.reduce(0) { $0 + $1.points } }

    var body: some View {
        TagCard(tag: "Contribute & earn · today", color: Ink.mint) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 14) {
                    ZStack {
                        CoinView(size: 40).offset(x: 14, y: 10)
                        CoinView(size: 52)
                    }
                    .frame(width: 70, height: 64)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(total > 0 ? "+\(total) point\(total == 1 ? "" : "s") today" : "No points yet today")
                            .font(.display(.title3)).foregroundStyle(Ink.charcoal)
                        Text(total > 0 ? "Nice work. Keep answering to earn more." : "Answer a request near you to start earning.")
                            .font(.soft(.caption)).foregroundStyle(Ink.muted)
                    }
                }
                if !entries.isEmpty || streak > 1 {
                    VStack(spacing: 0) {
                        ForEach(entries.prefix(4)) { row(icon: "checkmark", fill: Ink.mint, title: $0.title, value: "+\($0.points)") }
                        if streak > 1 { row(icon: "flame.fill", fill: Ink.butter, title: "Streak: \(streak) days in a row", value: "🔥") }
                    }
                    .inkOutline(14, fill: Ink.paper, line: 1.5)
                }
                Button(action: onRedeem) { Label("Redeem rewards", systemImage: "gift.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.chunky(Ink.pink, height: 46))
            }
        }
    }

    private func row(icon: String, fill: Color, title: String, value: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.caption.weight(.black)).foregroundStyle(Ink.charcoal)
                .frame(width: 24, height: 24).background(Circle().fill(fill)).overlay(Circle().strokeBorder(Ink.charcoal, lineWidth: 1.5))
            Text(title).font(.soft(.subheadline)).foregroundStyle(Ink.charcoal).lineLimit(1)
            Spacer()
            Text(value).font(.bold(.subheadline)).foregroundStyle(Ink.blue)
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
    }
}

// MARK: - Thank-you screen after an answer

struct Contribution: Identifiable {
    let id = UUID()
    let place: String
    let answer: String?
    let noiseDb: Int?
    let points: Int
    var isSample = false
    var photo: UIImage?
    var headcount: Int?
    var mbps: Double?
    var detail: String?
}

struct ContributionSuccessView: View {
    let contribution: Contribution
    var onImpact: () -> Void
    var onDone: () -> Void
    @State private var pop = false

    var body: some View {
        ZStack {
            DotBackground().ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    OraArtwork.image.resizable().scaledToFit().frame(height: 170)
                        .scaleEffect(pop ? 1 : 0.55).rotationEffect(.degrees(pop ? 0 : -10))
                        .padding(.top, 40)
                    Text("Thanks for contributing! 🎉").font(.display(.title)).foregroundStyle(Ink.charcoal).multilineTextAlignment(.center)
                    HStack(spacing: 8) {
                        CoinView(size: 26)
                        Text("+\(contribution.points) \(contribution.isSample ? "sample " : "")point\(contribution.points == 1 ? "" : "s")")
                            .font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .inkOutline(22, fill: Ink.butter, line: Ink.line)
                    TagCard(tag: "Your contribution", color: Ink.mint) {
                        VStack(spacing: 0) {
                            row("mappin.and.ellipse", Ink.pinkSoft, contribution.place)
                            if let db = contribution.noiseDb {
                                let level = NoiseLevel(db: Double(db))
                                row("waveform", level.soft, "Noise: \(level.title) (\(db) dB)")
                            }
                            if let mbps = contribution.mbps {
                                let level = WifiLevel(mbps: mbps)
                                row("wifi", level.soft, "Wi-Fi: \(level.title) (\(mbps.formatted()) Mbps)")
                            }
                            if let count = contribution.headcount { row("person.2.fill", Ink.mintSoft, "Counted about \(count) people") }
                            if let answer = contribution.answer { row("person.3.fill", Ink.periSoft, "Your answer: \(answer)") }
                        }
                    }
                    if let photo = contribution.photo {
                        VStack(spacing: 6) {
                            Image(uiImage: photo).resizable().scaledToFill()
                                .frame(height: 190).frame(maxWidth: .infinity).clipped()
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: Ink.line))
                                .accessibilityLabel("Your photo, with private details blurred")
                            Label("Faces, badges, screens and plates blurred", systemImage: "eye.slash").font(.soft(.caption)).foregroundStyle(Ink.muted)
                        }
                    }
                    if let detail = contribution.detail { Text(detail).font(.bold(.footnote)).foregroundStyle(Ink.charcoal).multilineTextAlignment(.center) }
                    Text(contribution.isSample ? "Sample only. Nothing was sent." : "Your answer helps an AI agent see what’s happening right now.")
                        .font(.soft(.footnote)).foregroundStyle(Ink.muted).multilineTextAlignment(.center)
                    Button(action: onImpact) { HStack(spacing: 8) { Text("View impact"); Image(systemName: "arrow.right") }.frame(maxWidth: .infinity) }
                        .buttonStyle(.chunky(Ink.blue, text: .white))
                    Button(action: onDone) { Text("Done").frame(maxWidth: .infinity) }
                        .buttonStyle(.chunky(Ink.paper, height: 46))
                }
                .padding(.horizontal, 22).padding(.bottom, 24)
                .frame(maxWidth: 520).frame(maxWidth: .infinity)
            }
            ConfettiBurst()
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.55)) { pop = true }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            AppSounds.shared.play(.success)
        }
    }

    private func row(_ icon: String, _ fill: Color, _ text: String) -> some View {
        HStack(spacing: 12) {
            IconBadge(symbol: icon, fill: fill, size: 34)
            Text(text).font(.bold(.subheadline)).foregroundStyle(Ink.charcoal)
            Spacer()
        }
        .padding(.vertical, 6)
    }
}

/// One burst of falling confetti and coins, in the app palette.
struct ConfettiBurst: View {
    private struct Piece { let x: CGFloat; let delay: Double; let color: Color; let size: CGFloat; let spin: Double; let coin: Bool }
    @State private var pieces: [Piece] = (0..<30).map { i in
        Piece(x: .random(in: 0.03...0.97), delay: .random(in: 0...0.7),
              color: [Ink.mint, Ink.pink, Ink.butter, Ink.periwinkle, Ink.blue].randomElement() ?? Ink.butter,
              size: .random(in: 7...12), spin: .random(in: 200...760), coin: i % 6 == 0)
    }
    @State private var fall = false

    var body: some View {
        GeometryReader { g in
            ForEach(pieces.indices, id: \.self) { i in
                let p = pieces[i]
                Group {
                    if p.coin { CoinView(size: 20) }
                    else {
                        RoundedRectangle(cornerRadius: 2).fill(p.color).frame(width: p.size, height: p.size * 1.6)
                            .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Ink.charcoal, lineWidth: 1))
                    }
                }
                .rotationEffect(.degrees(fall ? p.spin : 0))
                .position(x: p.x * g.size.width, y: fall ? g.size.height + 40 : -30)
                .animation(.easeIn(duration: 2.8).delay(p.delay), value: fall)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { fall = true }
    }
}

// MARK: - Venue imagery from Apple (no API key)

/// Street-level Look Around photo when Apple has one there, otherwise a 3D satellite view.
@MainActor enum VenueSnapshot {
    enum Kind { case lookAround, satellite }
    struct Shot { let image: UIImage; let kind: Kind }
    private static var cache: [String: Shot] = [:]

    static func load(_ place: NearbyPlace, size: CGSize = CGSize(width: 640, height: 360)) async -> Shot? {
        if let hit = cache[place.id] { return hit }
        // Look Around can be slow (or missing): give it 3 seconds while the satellite view renders alongside.
        async let satellite = satelliteShot(place, size: size)
        let street: Shot? = await withTaskGroup(of: Shot?.self) { group in
            group.addTask { await lookAroundShot(place, size: size) }
            group.addTask { try? await Task.sleep(for: .seconds(3)); return nil }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
        let aerial = await satellite
        let shot = street ?? aerial
        if let shot { cache[place.id] = shot }
        return shot
    }

    private static func lookAroundShot(_ place: NearbyPlace, size: CGSize) async -> Shot? {
        guard let scene = try? await MKLookAroundSceneRequest(coordinate: place.coordinate).scene else { return nil }
        let options = MKLookAroundSnapshotter.Options()
        options.size = size
        guard let snap = try? await MKLookAroundSnapshotter(scene: scene, options: options).snapshot else { return nil }
        return Shot(image: snap.image, kind: .lookAround)
    }

    private static func satelliteShot(_ place: NearbyPlace, size: CGSize) async -> Shot? {
        let options = MKMapSnapshotter.Options()
        options.camera = MKMapCamera(lookingAtCenter: place.coordinate, fromDistance: 420, pitch: 55, heading: 30)
        options.preferredConfiguration = MKHybridMapConfiguration(elevationStyle: .realistic)
        options.size = size
        guard let snap = try? await MKMapSnapshotter(options: options).start() else { return nil }
        return Shot(image: snap.image, kind: .satellite)
    }
}

/// Fills its frame with the Apple imagery for a place; shows `fallback` if none can be made.
struct VenueSnapshotFill<Fallback: View>: View {
    let place: NearbyPlace
    var showsLabel = true
    @ViewBuilder var fallback: Fallback
    @State private var shot: VenueSnapshot.Shot?
    @State private var finished = false

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            if let shot {
                Image(uiImage: shot.image).resizable().scaledToFill()
                    .frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                    .transition(.opacity)
                if showsLabel {
                    Chip(text: shot.kind == .lookAround ? "Look Around" : "Satellite view",
                         symbol: shot.kind == .lookAround ? "binoculars.fill" : "globe.americas.fill", fill: Ink.paper)
                        .padding(10)
                }
            } else if finished {
                fallback
            } else {
                ProgressView().tint(Ink.charcoal).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .animation(.easeOut(duration: 0.25), value: shot != nil)
        .task(id: place.id) {
            shot = await VenueSnapshot.load(place)
            finished = true
        }
    }
}
