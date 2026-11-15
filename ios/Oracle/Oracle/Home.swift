import SwiftUI

/// Search field shared by Home and Explore: outlined pill with dictation.
struct PlaceSearchBar: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    var placeholder = "Search a city, café or venue"
    var identifier = "placeSearch"
    let submit: (String) -> Void
    @State private var voice = VoiceInput()

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.body.weight(.bold)).foregroundStyle(Ink.charcoal).padding(.leading, 14)
                .accessibilityHidden(true)
            TextField(placeholder, text: $text)
                .font(.soft(.body))
                .foregroundStyle(Ink.charcoal)
                .focused(focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .onSubmit { submit(text) }
                .accessibilityLabel("Search places")
                .accessibilityIdentifier(identifier)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Ink.muted).frame(width: 36, height: 44) }
                    .accessibilityLabel("Clear search")
            }
            Button {
                if voice.recording { voice.stop() } else { Task { await voice.start { text = $0 } } }
            } label: {
                Image(systemName: voice.recording ? "stop.fill" : "mic.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Ink.charcoal)
                    .frame(width: 40, height: 40)
                    .inkOutline(12, fill: voice.recording ? Ink.pink : Ink.pinkSoft, line: 2)
            }
            .accessibilityLabel(voice.recording ? "Stop dictation" : "Dictate a search")
            .padding(.trailing, 5)
        }
        .frame(minHeight: 52)
        .inkCard(fill: Ink.paper, radius: 18, shadow: 4, padding: 0)
        .alert("Dictation", isPresented: Binding(get: { voice.issue != nil }, set: { if !$0 { voice.issue = nil } })) {
            Button("OK") { voice.issue = nil }
        } message: { Text(voice.issue ?? "") }
        .onDisappear { voice.stop() }
    }
}

struct HomeScreen: View {
    @Environment(Router.self) private var router
    @Environment(PlaceSearch.self) private var search
    @Environment(OracleSession.self) private var session
    @AppStorage("oracle.appleName") private var appleName = ""
    @State private var query = ""
    @FocusState private var searching: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                PlaceSearchBar(text: $query, focused: $searching, identifier: "homeSearch") { submit($0) }
                OraHero(title: greeting, message: "Ask about any real place. People who are there answer in about a minute.", oraSize: 104)
                VStack(alignment: .leading, spacing: 2) {
                    Text("What’s it like").font(.display(.largeTitle)).foregroundStyle(Ink.charcoal)
                    Text("right now?").font(.display(.largeTitle)).foregroundStyle(Ink.blue)
                }
                .accessibilityElement(children: .combine)
                actions
                CrowdGuessCard()
                nearby
                howItWorks
                Button { router.present(.assistants) } label: {
                    HStack(spacing: 12) {
                        HStack(spacing: -8) {
                            AssistantLogo(assistant: .claude, size: 34)
                            AssistantLogo(assistant: .chatGPT, size: 34)
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Ask from Claude or ChatGPT").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                            Text("Connect Oracle to your AI assistant").font(.soft(.subheadline)).foregroundStyle(Ink.muted)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.body.weight(.bold)).foregroundStyle(Ink.charcoal)
                    }
                    .inkCard()
                }
                .buttonStyle(SquishStyle())
            }
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
            .frame(maxWidth: 600).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(DotBackground())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var greeting: String { appleName.isEmpty ? "hi there!!" : "hi \(appleName)!!" }

    private var header: some View {
        HStack {
            OracleWordmark()
            Spacer()
            Button { router.present(.location) } label: {
                Chip(text: search.area?.title ?? "Choose area", symbol: search.area?.nearMe == true ? "location.fill" : "mappin", fill: Ink.butterSoft)
                    .frame(maxWidth: 170).frame(minHeight: 44)
            }
            .buttonStyle(SquishStyle())
            .accessibilityLabel("Area: \(search.area?.title ?? "not chosen"). Change area")
        }
    }

    private var actions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { exploreButton; earnButton }
            VStack(spacing: 10) { exploreButton; earnButton }
        }
    }
    private var exploreButton: some View {
        Button { router.select(.explore) } label: { Label("Explore places", systemImage: "map.fill").frame(maxWidth: .infinity) }
            .buttonStyle(.chunky(Ink.blue, text: .white))
    }
    private var earnButton: some View {
        Button { router.select(.requests) } label: { Label("Answer & earn", systemImage: "bolt.fill").frame(maxWidth: .infinity) }
            .buttonStyle(.chunky(Ink.mint))
    }

    @ViewBuilder private var nearby: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: search.area.map { "Around \($0.nearMe ? "you" : $0.title)" } ?? "Nearby places",
                         trailing: search.places.isEmpty ? nil : "See map") { router.select(.explore) }
            switch search.phase {
            case .idle:
                if search.hasArea { ProgressView().frame(maxWidth: .infinity).padding() } else {
                    NoticeCard(kind: .info, title: "Choose an area", message: "Use your location or search for a city to see places.",
                               actionTitle: "Choose area") { router.present(.location) }
                }
            case .loading:
                HStack(spacing: 10) { ProgressView().tint(Ink.charcoal); Text("Finding places…").font(.soft(.subheadline)) }
                    .frame(maxWidth: .infinity, alignment: .leading).inkCard(shadow: 4, padding: 14)
            case .empty(let message):
                NoticeCard(kind: .info, title: "Nothing here yet", message: message, actionTitle: "Change area") { router.present(.location) }
            case .failed(let error):
                NoticeCard(kind: .error, title: error.title, message: error.message, actionTitle: "Retry") { search.retry() }
            case .loaded:
                VStack(spacing: 10) {
                    ForEach(search.places.prefix(4)) { place in
                        Button { search.select(place); router.openPlace(place, in: .home) } label: { PlaceRow(place: place) }
                            .buttonStyle(SquishStyle())
                            .accessibilityIdentifier("placeRow")
                    }
                }
            }
        }
    }

    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: "How Oracle works")
            HStack(alignment: .top, spacing: 10) {
                TagCard(tag: "1 · Ask", color: Ink.pink, shadow: 4) { Text("An AI agent asks about a place").font(.bold(.footnote)).fixedSize(horizontal: false, vertical: true) }
                TagCard(tag: "2 · Answer", color: Ink.periwinkle, shadow: 4) { Text("People checked in nearby tap a reply").font(.bold(.footnote)).fixedSize(horizontal: false, vertical: true) }
                TagCard(tag: "3 · Earn", color: Ink.butter, shadow: 4) { Text("Matching answers earn points").font(.bold(.footnote)).fixedSize(horizontal: false, vertical: true) }
            }
        }
    }

    private func submit(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        searching = false
        search.search(clean)
        query = ""
        router.select(.explore)
    }
}

/// Compact nearby-place card.
struct PlaceRow: View {
    let place: NearbyPlace
    var selected = false
    var body: some View {
        HStack(spacing: 12) {
            IconBadge(symbol: place.symbol, fill: place.tint, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(place.name).font(.bold(.headline)).foregroundStyle(Ink.charcoal).lineLimit(2).multilineTextAlignment(.leading)
                if !place.subtitle.isEmpty {
                    Text(place.subtitle).font(.soft(.caption)).foregroundStyle(Ink.muted).lineLimit(1)
                }
                if let answer = place.headline?.answer {
                    Label(answer, systemImage: "bubble.left.fill").font(.bold(.caption)).foregroundStyle(Ink.blue).lineLimit(1)
                } else if let people = place.people_here, people > 0 {
                    Label("\(people) checked in", systemImage: "person.2.fill").font(.bold(.caption)).foregroundStyle(Ink.blue)
                }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.subheadline.weight(.heavy)).foregroundStyle(Ink.charcoal)
        }
        .inkCard(fill: selected ? Ink.butterSoft : Ink.paper, radius: 18, shadow: 4, padding: 12)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens place details")
    }
}
