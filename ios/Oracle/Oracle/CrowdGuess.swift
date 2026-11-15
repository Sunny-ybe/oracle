import SwiftUI

// MARK: - Crowd Guess: "Can you read the room?"
//
// Each round is a real question that people at a real place answered on Oracle (GET /api/game/rounds).
// Guess what they reported before the timer runs out. Quick right answers score more; streaks add a bonus.
// Play requires eight nearby, distinct photos with settled crowd-report evidence.

struct GuessRound: Decodable, Identifiable, Equatable {
    let id: String
    let place: String
    var placeId: String?
    var lat: Double?
    var lng: Double?
    var kind: String?
    let question: String
    let options: [String]
    let answer: Int          // 1...3
    var votes: Int?
    var source: String?
    var at: String?
    let photoUrl: String
    let photoId: String
    let photoAt: String
    let evidenceText: String


    private enum CodingKeys: String, CodingKey { case id, place, placeId, lat, lng, kind, question, options, answer, votes, source, at, photoUrl, photoId, photoAt
        case evidenceText = "evidence"
    }

    var evidence: String {
        let who = source == "photo" ? "Photo-verified report" : "\(votes ?? 0) \(votes == 1 ? "person" : "people") reported it"
        let when = ISO8601.relative(at).map { " · \($0)" } ?? ""
        return who + when
    }


}


struct GuessCatalog: Decodable {
    let minimumPhotos: Int
    let availablePhotos: Int
    let radiusM: Int
    let rounds: [GuessRound]
    static let minimum = 8

    static func path(for area: SearchArea) -> String {
        "api/game/rounds?lat=\(area.lat)&lng=\(area.lng)"
    }
}

struct CrowdGuessGame: View {
    @Environment(OracleSession.self) private var session
    @Environment(Router.self) private var router
    @Environment(PlaceSearch.self) private var search
    @Environment(\.dismiss) private var dismiss
    @AppStorage("crowdguess.best") private var best = 0

    private enum Phase { case intro, loading, playing, finished, unavailable }
    private static let seconds = 8.0

    @State private var phase = Phase.intro
    @State private var rounds: [GuessRound] = []
    @State private var index = 0
    @State private var picked: Int?         // 1...3; 0 = time ran out
    @State private var score = 0
    @State private var streak = 0
    @State private var correct = 0
    @State private var lastGain = 0
    @State private var roundStart = Date()
    @State private var newBest = false
    @State private var unavailable = ""
    @State private var photos: [String: UIImage] = [:]
    @State private var areaTitle = ""


    private var round: GuessRound? { rounds.indices.contains(index) ? rounds[index] : nil }
    private var catalogKey: String { search.area.map { GuessCatalog.path(for: $0) } ?? "" }

    var body: some View {
        NavigationStack {
            ZStack {
                DotBackground().ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 16) {
                        switch phase {
                        case .intro: intro
                        case .loading: ProgressView("Finding real answers…").tint(Ink.charcoal).padding(.top, 80)
                        case .playing: if let round { play(round) }
                        case .finished: finished
                        case .unavailable:
                            NoticeCard(kind: .info, title: "More nearby photos needed", message: unavailable)
                            Button("Check again") { Task { await start() } }.buttonStyle(.chunky(Ink.blue, text: .white))
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: 560).frame(maxWidth: .infinity)
                }
                if phase == .finished && newBest { ConfettiBurst() }
            }
            .safeAreaInset(edge: .bottom) {
                if phase == .playing && picked != nil {
                    Button { next() } label: { Text(index + 1 < rounds.count ? "Next round" : "See my score").frame(maxWidth: .infinity) }
                        .buttonStyle(.chunky(Ink.blue, text: .white))
                        .padding(.horizontal, 20).padding(.vertical, 12)
                        .background(Ink.cream)
                }
            }
            .navigationTitle("Crowd Guess")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.font(.bold(.body)) } }
        }
        .onChange(of: catalogKey) { _, _ in
            rounds = []; photos = [:]; phase = .intro
        }
    }

    // MARK: Screens

    private var intro: some View {
        VStack(spacing: 16) {
            OraHero(title: "can you read the room?", message: "Play with 8 real photos from \(search.area?.title ?? "your selected area"). Each answer has a matching crowd report.", oraSize: 100)
            TagCard(tag: "How to play", color: Ink.butter) {
                VStack(alignment: .leading, spacing: 10) {
                    rule("mappin.and.ellipse", Ink.pinkSoft, "Eight nearby photos, each with a settled crowd report. The report and photo dates appear after your guess.")
                    rule("timer", Ink.periSoft, "You have 8 seconds. Faster right answers earn more.")
                    rule("flame.fill", Ink.butterSoft, "Get 3 in a row for a streak bonus.")
                }
            }
            if best > 0 { Chip(text: "Your best: \(best)", symbol: "trophy.fill", fill: Ink.butterSoft) }
            Button { Task { await start() } } label: { Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity) }
                .buttonStyle(.chunky(Ink.blue, text: .white))
                .accessibilityIdentifier("playCrowdGuess")
        }
    }

    private func play(_ round: GuessRound) -> some View {
        VStack(spacing: 14) {
            HStack(spacing: 8) {
                Chip(text: "Round \(index + 1) of \(rounds.count)", symbol: "gamecontroller.fill", fill: Ink.paper)
                Spacer()
                if streak >= 2 { Chip(text: "\(streak) 🔥", fill: Ink.butterSoft) }
                Chip(text: "\(score)", symbol: "star.fill", fill: Ink.butter)
            }
            TagCard(tag: round.place, color: Ink.mint) {
                VStack(alignment: .leading, spacing: 12) {
                    if let photo = photos[round.photoId] {
                        Image(uiImage: photo).resizable().scaledToFill()
                            .frame(height: 180).frame(maxWidth: .infinity).clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .accessibilityLabel("Contributor photo of \(round.place)")
                    }
                    Text(round.question).font(.display(.title3)).foregroundStyle(Ink.charcoal).fixedSize(horizontal: false, vertical: true)
                    timer
                    ForEach(Array(round.options.enumerated()), id: \.offset) { i, option in
                        optionButton(option, number: i + 1, round: round)
                    }
                    if picked != nil {
                        Text(round.evidenceText).font(.soft(.subheadline)).foregroundStyle(Ink.charcoal)
                        if let date = ISO8601.parse(round.photoAt) {
                            Text("Photo submitted \(date.formatted(date: .abbreviated, time: .shortened))").font(.soft(.caption)).foregroundStyle(Ink.muted)
                        }
                        HStack(spacing: 8) {
                            Image(systemName: picked == round.answer ? "checkmark.seal.fill" : "info.circle.fill")
                            Text(picked == round.answer ? "+\(lastGain) · \(round.evidence)" : (picked == 0 ? "Time’s up · \(round.evidence)" : round.evidence))
                        }
                        .font(.bold(.caption)).foregroundStyle(Ink.muted)
                    }
                }
            }
        }
        .animation(.easeOut(duration: 0.2), value: picked)
    }

    private var timer: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20, paused: picked != nil)) { tick in
            let left = max(0, Self.seconds - tick.date.timeIntervalSince(roundStart))
            let fraction = picked == nil ? left / Self.seconds : 0
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Ink.charcoal.opacity(0.08))
                    Capsule().fill(fraction > 0.35 ? Ink.mint : Ink.pink).frame(width: max(0, g.size.width * fraction))
                }
                .overlay(Capsule().strokeBorder(Ink.charcoal, lineWidth: 1.5))
            }
            .frame(height: 12)
            .onChange(of: left <= 0) { _, out in if out && picked == nil { choose(0) } }
        }
        .accessibilityHidden(true)
    }

    private func optionButton(_ option: String, number: Int, round: GuessRound) -> some View {
        let revealed = picked != nil
        let isAnswer = number == round.answer
        let fill: Color = !revealed ? Ink.paper : isAnswer ? Ink.mint : (picked == number ? Ink.pink : Ink.paper)
        return Button { choose(number) } label: {
            HStack {
                Text(option).font(.bold(.headline))
                Spacer()
                if revealed && isAnswer { Image(systemName: "checkmark.circle.fill").font(.title3.weight(.bold)) }
                else if revealed && picked == number { Image(systemName: "xmark.circle.fill").font(.title3.weight(.bold)) }
            }
            .foregroundStyle(Ink.charcoal)
            .padding(.horizontal, 16).frame(minHeight: 52)
            .inkOutline(16, fill: fill, line: revealed && (isAnswer || picked == number) ? 3 : 2)
            .opacity(revealed && !isAnswer && picked != number ? 0.55 : 1)
        }
        .buttonStyle(SquishStyle())
        .disabled(revealed)
        .accessibilityIdentifier("guessOption")
    }

    private var finished: some View {
        VStack(spacing: 16) {
            OraArtwork.image.resizable().scaledToFit().frame(height: 150)
            Text(newBest ? "New best score! 🎉" : "Nice reading!").font(.display(.title)).foregroundStyle(Ink.charcoal)
            HStack(spacing: 8) {
                CoinView(size: 26)
                Text("\(score) points").font(.bold(.title3)).foregroundStyle(Ink.charcoal)
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .inkOutline(22, fill: Ink.butter, line: Ink.line)
            TagCard(tag: "Your game", color: Ink.mint) {
                VStack(alignment: .leading, spacing: 8) {
                    rule("checkmark.circle.fill", Ink.mintSoft, "\(correct) of \(rounds.count) right")
                    rule("trophy.fill", Ink.butterSoft, "Best score: \(best)")
                    rule("photo.fill", Ink.periSoft, "\(rounds.count) photos with crowd-report evidence from \(areaTitle)")
                }
            }
            Text("Game points are just for fun. Answer real requests to earn Oracle points.")
                .font(.soft(.footnote)).foregroundStyle(Ink.muted).multilineTextAlignment(.center)
            Button { Task { await start() } } label: { Label("Play again", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity) }
                .buttonStyle(.chunky(Ink.blue, text: .white))
            Button { dismiss(); router.select(.requests) } label: { Label("Earn real points", systemImage: "bolt.fill").frame(maxWidth: .infinity) }
                .buttonStyle(.chunky(Ink.mint, height: 46))
        }
    }

    private func rule(_ icon: String, _ fill: Color, _ text: String) -> some View {
        HStack(spacing: 10) {
            IconBadge(symbol: icon, fill: fill, size: 32)
            Text(text).font(.bold(.subheadline)).foregroundStyle(Ink.charcoal)
            Spacer(minLength: 0)
        }
    }

    // MARK: Game logic

    private func start() async {
        guard let area = search.area else {
            unavailable = "Choose your location or search an area before playing."
            phase = .unavailable
            return
        }
        let key = GuessCatalog.path(for: area)
        phase = .loading
        do {
            let catalog: GuessCatalog = try await session.request(key)
            guard catalogKey == key else { phase = .intro; return }
            guard catalog.availablePhotos >= GuessCatalog.minimum, catalog.rounds.count >= GuessCatalog.minimum else {
                unavailable = "\(catalog.availablePhotos) of 8 photo-backed crowd reports are available within 3 km of \(area.title). Check back after people contribute more photos."
                phase = .unavailable
                return
            }
            let selected = Array(catalog.rounds.shuffled().prefix(GuessCatalog.minimum))
            guard Set(selected.map(\.photoId)).count == GuessCatalog.minimum,
                  selected.allSatisfy({ $0.options.count == 3 && (1...3).contains($0.answer) }) else { throw APIError.badResponse }
            var loaded: [String: UIImage] = [:]
            for round in selected {
                guard let url = session.absoluteURL(round.photoUrl) else { throw APIError.badResponse }
                let (data, response) = try await URLSession.shared.data(from: url)
                guard (response as? HTTPURLResponse)?.statusCode == 200, let image = UIImage(data: data) else { throw APIError.badResponse }
                loaded[round.photoId] = image
                try Task.checkCancellation()
            }
            guard catalogKey == key else { phase = .intro; return }
            rounds = selected; photos = loaded; areaTitle = area.title
            index = 0; score = 0; streak = 0; correct = 0; picked = nil; newBest = false
            roundStart = .now
            phase = .playing
        } catch {
            guard !Task.isCancelled else { return }
            unavailable = "Couldn’t load 8 nearby photos and their evidence. \(UserFacingError.from(error, context: "Crowd Guess").message)"
            phase = .unavailable
        }
    }

    private func choose(_ number: Int) {
        guard picked == nil, let round else { return }
        picked = number
        if number == round.answer {
            let left = max(0, Self.seconds - Date().timeIntervalSince(roundStart))
            streak += 1; correct += 1
            lastGain = 100 + Int(left * 10) + (streak >= 3 ? 50 : 0)
            score += lastGain
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            AppSounds.shared.play(.success)
        } else {
            streak = 0; lastGain = 0
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            AppSounds.shared.play(.miss)
        }
    }

    private func next() {
        guard phase == .playing, picked != nil else { return }
        if index + 1 < rounds.count {
            index += 1; picked = nil; roundStart = .now
        } else {
            newBest = score > best
            if newBest { best = score }
            phase = .finished
        }
    }
}

/// Home entry point.
struct CrowdGuessCard: View {
    @Environment(Router.self) private var router
    @Environment(OracleSession.self) private var session
    @Environment(PlaceSearch.self) private var search
    @State private var catalog: GuessCatalog?
    @State private var loading = false
    @State private var loadError = false
    private var key: String { (search.area.map { GuessCatalog.path(for: $0) } ?? "") + "|" + session.baseURL }
    private var ready: Bool { catalog.map { $0.availablePhotos >= GuessCatalog.minimum && $0.rounds.count >= GuessCatalog.minimum } ?? false }
    private var subtitle: String {
        guard let area = search.area else { return "Choose an area to find photo-backed rounds." }
        if loading { return "Checking photos near \(area.title)…" }
        if loadError { return "Connect to Oracle to check photos near \(area.title)." }
        return ready ? "8 nearby photos with crowd-report evidence." : "\(catalog?.availablePhotos ?? 0) of 8 nearby photos with evidence available."
    }
    var body: some View {
        Button { router.present(.game) } label: {
            HStack(spacing: 12) {
                IconBadge(symbol: "gamecontroller.fill", fill: Ink.periwinkle, size: 46)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Crowd Guess").font(.display(.headline)).foregroundStyle(Ink.charcoal)
                    Text(subtitle).font(.soft(.caption)).foregroundStyle(Ink.muted)
                }
                Spacer(minLength: 0)
                if loading { ProgressView() }
                else { Text(ready ? "Play" : "Needs photos").font(.bold(.caption)).foregroundStyle(Ink.blue) }
            }
            .inkCard(fill: Ink.periSoft, shadow: 4, padding: 12)
        }
        .buttonStyle(SquishStyle())
        .disabled(!ready)
        .accessibilityIdentifier("crowdGuessCard")
        .task(id: key) {
            catalog = nil; loadError = false
            guard let area = search.area else { return }
            loading = true
            defer { loading = false }
            do { catalog = try await session.request(GuessCatalog.path(for: area)) }
            catch { if !Task.isCancelled { loadError = true } }
        }
    }
}
