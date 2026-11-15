import SwiftUI
import AuthenticationServices

struct ContentView: View {
    @State private var session: OracleSession
    @State private var search: PlaceSearch
    @State private var location = LocationService()
    @State private var router = Router()
    @State private var network = Connectivity()
    @State private var launching = true
    @AppStorage("oracle.onboarded") private var onboarded = false
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let session = OracleSession()
        _session = State(initialValue: session)
        _search = State(initialValue: PlaceSearch(session: session))
    }

    var body: some View {
        ZStack {
            DotBackground()
            if launching {
                LaunchScreen()
            } else if !onboarded {
                FirstUseScreen { onboarded = true }
                    .transition(.opacity)
            } else {
                MainTabs()
                    .transition(.opacity)
            }
        }
        .environment(session)
        .environment(search)
        .environment(location)
        .environment(router)
        .environment(network)
        .tint(Ink.blue)
        .preferredColorScheme(.light)
        .task {
            // Notification taps open the poll; answer buttons send the answer straight away.
            Notifier.shared.open = { [router] request in router.present(.poll(request)) }
            Notifier.shared.answer = { [session] request, option in
                guard let result: ServerMessage = try? await session.request("api/app/answer/\(request.id)", body: ["option": option]),
                      result.ok == true else { return false }
                let points = result.points ?? 1
                EarningsLog.add(.init(title: "Poll response · \(request.place)", points: points, at: .now))
                let choice = request.options.indices.contains(option - 1) ? request.options[option - 1] : "your answer"
                await Notifier.shared.confirm("✅ Sent “\(choice)” for \(request.place). +\(points) point\(points == 1 ? "" : "s") 🦉")
                try? await session.refreshAccount()
                return true
            }
            // Live location → server, which matches you to the place you're in.
            LiveLocation.shared.upload = { [session] fix in
                guard session.isConnected else { throw CancellationError() }
                struct CheckIn: Decodable { let ok: Bool?; let place: String? }
                let result: CheckIn = try await session.request("api/app/checkin", body: [
                    "lat": fix.coordinate.latitude, "lng": fix.coordinate.longitude, "accuracy": Int(fix.horizontalAccuracy.rounded()),
                ])
                try? await session.refreshAccount()
                return result.place
            }
            LiveLocation.shared.start()
            // Apple Push token → server, so requests reach this phone while the app is closed.
            // The server also learns which APNs server issued the token (development vs TestFlight / App Store)
            // and which sound to play.
            Notifier.shared.uploadToken = { [session] token in
                guard session.isConnected else { return }
                let _: ServerMessage? = try? await session.request("api/app/apns", body: [
                    "token": token, "sandbox": Notifier.apnsSandbox, "sound": Notifier.shared.soundPreference,
                ])
            }
            async let restore: Void = session.restore()
            try? await Task.sleep(for: .seconds(2))
            withAnimation(.easeOut(duration: 0.25)) { launching = false }
            await restore
            if onboarded { search.reloadSavedArea() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, session.hasStoredSession { Task { await session.restore() } }
            if phase == .active { Task { await Notifier.shared.registerIfAllowed() } }  // permission may have changed in iPhone Settings
            if phase == .active { LiveLocation.shared.start() } else if phase == .background { LiveLocation.shared.pause(); AppSounds.shared.stop() }
        }
    }
}

// MARK: - Tabs

private struct MainTabs: View {
    @Environment(Router.self) private var router
    @Environment(OracleSession.self) private var session
    @State private var keyboardVisible = false

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            // TabView keeps each navigation stack separate and routes touches to the selected tab.
            tabRoot(.home) { NavigationStack(path: $router.homePath) { HomeScreen().placeDestination(tab: .home) } }
            tabRoot(.explore) { NavigationStack(path: $router.explorePath) { ExploreScreen().placeDestination(tab: .explore) } }
            tabRoot(.requests) { NavigationStack { RequestsScreen() } }
            tabRoot(.rewards) { NavigationStack { RewardsScreen() } }
            tabRoot(.settings) { NavigationStack { SettingsScreen() } }
        }
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !keyboardVisible { InkTabBar() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
        .sheet(item: $router.sheet) { sheet in
            Group {
                switch sheet {
                case .account: AccountScreen()
                case .poll(let request): LivePoll(request: request)
                case .assistants: NavigationStack { AssistantConnection() }
                case .location: LocationPicker(mode: .change)
                case .sample: SampleExperience()
                case .game: CrowdGuessGame()
                }
            }
            .environment(session)
            .environment(router)
        }
        .fullScreenCover(isPresented: $router.fullMap) { FullMapScreen() }
        .task(id: session.isConnected) {
            // While signed in and open, check for new requests so a notification can pop up for each.
            guard session.isConnected else { return }
            await Notifier.shared.requestPermission()
            if let token = Notifier.shared.deviceToken { await Notifier.shared.uploadToken?(token) }  // signed in after iOS gave the token
            LiveLocation.shared.resend()  // just signed in: tell the server where you are now
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if router.tab != .requests { try? await session.refreshAccount() }  // Requests tab polls on its own
            }
        }
    }

    private func tabRoot<V: View>(_ tab: AppTab, @ViewBuilder content: () -> V) -> some View {
        content()
            .tag(tab)
    }
}

private struct InkTabBar: View {
    @Environment(Router.self) private var router
    @Environment(OracleSession.self) private var session
    @Environment(\.dynamicTypeSize) private var typeSize
    @Namespace private var highlight

    var body: some View {
        HStack(spacing: 2) {
            ForEach(AppTab.allCases) { tab in
                let active = router.tab == tab
                Button {
                    withAnimation(.spring(duration: 0.3)) { router.select(tab) }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: tab.icon).font(.system(size: 17, weight: .bold))
                            .overlay(alignment: .topTrailing) {
                                if tab == .requests, let count = session.account?.requests.count, count > 0 {
                                    Text("\(count)").font(.system(size: 10, weight: .black, design: .rounded))
                                        .foregroundStyle(.white).padding(.horizontal, 5).padding(.vertical, 1)
                                        .background(Capsule().fill(Ink.danger)).offset(x: 10, y: -6)
                                }
                            }
                        if !typeSize.isAccessibilitySize {
                            Text(tab.rawValue).font(.system(size: 10, weight: .heavy, design: .rounded)).lineLimit(1).minimumScaleFactor(0.8)
                        }
                    }
                    .foregroundStyle(Ink.charcoal)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background {
                        if active {
                            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(tab.color)
                                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: 2))
                                .matchedGeometryEffect(id: "tab", in: highlight)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(SquishStyle())
                .accessibilityLabel(tab.rawValue)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(6)
        .inkCard(fill: Ink.paper, radius: 22, shadow: 4, padding: 0)
        .padding(.horizontal, 14)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .background(alignment: .bottom) {
            LinearGradient(colors: [Ink.cream.opacity(0), Ink.cream], startPoint: .top, endPoint: .center)
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

extension View {
    func placeDestination(tab: AppTab) -> some View {
        navigationDestination(for: NearbyPlace.self) { place in PlaceScreen(place: place, tab: tab) }
    }
    /// Shared screen chrome: cream background, hidden system bar background, consistent side padding.
    func screenBackground() -> some View {
        background(DotBackground()).toolbarBackground(.hidden, for: .navigationBar)
    }
}

// MARK: - Launch

private struct LaunchScreen: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @State private var start = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { tick in
            let time = reduceMotion ? 0 : tick.date.timeIntervalSince(start)
            VStack(spacing: 0) {
                Spacer()
                ZStack {
                    RoundedRectangle(cornerRadius: 38).fill(Ink.butterSoft)
                        .frame(width: 180, height: 180).rotationEffect(.degrees(-13))
                    RoundedRectangle(cornerRadius: 36).fill(Ink.paper)
                        .frame(width: 166, height: 166)
                        .overlay(RoundedRectangle(cornerRadius: 36).strokeBorder(Ink.charcoal.opacity(0.13), lineWidth: 1.5))
                        .rotationEffect(.degrees(9))
                    Image("OracleMark").resizable().scaledToFit().frame(width: 140, height: 140)
                        .clipShape(RoundedRectangle(cornerRadius: 34))
                        .overlay(RoundedRectangle(cornerRadius: 34).strokeBorder(Ink.charcoal, lineWidth: 2.5))
                        .background(RoundedRectangle(cornerRadius: 34).fill(Ink.charcoal).offset(x: 4, y: 5))
                        .offset(y: reduceMotion ? 0 : sin(time * 2.5) * 4)
                    launchBadge("location.fill", fill: Ink.periwinkle)
                        .offset(x: -105, y: 36 + (reduceMotion ? 0 : sin(time * 2.8 + 1) * 5))
                    launchBadge("bubble.left.fill", fill: Ink.pinkSoft)
                        .offset(x: 105, y: -38 + (reduceMotion ? 0 : sin(time * 2.8 + 2) * 5))
                }
                .frame(width: 280, height: 230)
                .scaleEffect(appeared || reduceMotion ? 1 : 0.9)
                .opacity(appeared || reduceMotion ? 1 : 0)
                Text("Oracle").font(.system(size: 44, weight: .black, design: .rounded))
                    .foregroundStyle(Ink.charcoal).padding(.top, 14)
                Text("A little local knowledge.").font(.soft(.body)).foregroundStyle(Ink.muted).padding(.top, 8)
                HStack(spacing: 7) {
                    ForEach(0..<3) { index in
                        let pulse = reduceMotion ? 0.65 : (sin(time * 6 - Double(index) * 0.8) + 1) / 2
                        Circle().fill(Ink.blue.opacity(0.25 + pulse * 0.75)).frame(width: 7, height: 7)
                            .offset(y: reduceMotion ? 0 : -pulse * 3)
                    }
                }
                .padding(.top, 28)
                Spacer()
                Text("REAL PLACES. REAL PEOPLE.")
                    .font(.system(.caption2, design: .rounded, weight: .heavy)).tracking(1.5)
                    .foregroundStyle(Ink.muted).padding(.bottom, 34)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Ink.cream.ignoresSafeArea())
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Oracle is opening")
        .accessibilityIdentifier("oracleLaunch")
        .onAppear {
            start = .now
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.35)) { appeared = true }
        }
    }

    private func launchBadge(_ symbol: String, fill: Color) -> some View {
        Image(systemName: symbol).font(.system(size: 18, weight: .bold)).foregroundStyle(Ink.charcoal)
            .frame(width: 43, height: 43).inkOutline(15, fill: fill, line: 2)
            .rotationEffect(.degrees(symbol == "location.fill" ? -9 : 9))
    }
}

// MARK: - First use

private struct FirstUseScreen: View {
    let finish: () -> Void
    @State private var step = 0
    var body: some View {
        Group {
            if step == 0 { WelcomeStep { withAnimation(.spring(duration: 0.35)) { step = 1 } } }
            else { LocationPicker(mode: .firstUse(finish)) }
        }
    }
}

private struct WelcomeStep: View {
    let next: () -> Void
    @AppStorage("oracle.appleID") private var appleID = ""
    @AppStorage("oracle.appleName") private var appleName = ""
    @State private var appleError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                OracleWordmark().padding(.top, 8)
                OraHero(title: "hi there!!", message: "I’m Ora. Ask about any real place and people nearby tell you what it’s like right now.", oraSize: 118)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Know before you go.").font(.display(.largeTitle)).foregroundStyle(Ink.charcoal)
                    Text("Help someone nearby.").font(.display(.largeTitle)).foregroundStyle(Ink.blue)
                }
                .fixedSize(horizontal: false, vertical: true)
                HStack(alignment: .top, spacing: 10) {
                    TagCard(tag: "Ask", color: Ink.pink) { Text("Lines, crowds, noise, anything").font(.bold(.subheadline)) }
                    TagCard(tag: "Earn", color: Ink.mint) { Text("Answer nearby, get points").font(.bold(.subheadline)) }
                }
                Button(action: next) { Label("Get started", systemImage: "arrow.right").frame(maxWidth: .infinity) }
                    .buttonStyle(.chunky)
                VStack(alignment: .leading, spacing: 8) {
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.fullName]
                    } onCompletion: { result in
                        switch result {
                        case .success(let auth):
                            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential else { return }
                            if let first = credential.fullName?.givenName { appleName = first }
                            appleID = credential.user
                            next()
                        case .failure(let error):
                            if (error as? ASAuthorizationError)?.code != .canceled { appleError = "Sign in with Apple didn’t finish. You can continue without it." }
                        }
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    Text("Sign in with Apple only saves your name on this iPhone. It does not create or connect an Oracle account. You can connect an Oracle account later in Settings to answer requests and earn points.")
                        .font(.soft(.caption)).foregroundStyle(Ink.muted)
                    if let appleError { Text(appleError).font(.soft(.caption)).foregroundStyle(Ink.danger) }
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}

/// Where should Oracle look? Used on first launch and from the area chip.
struct LocationPicker: View {
    enum Mode { case firstUse(() -> Void), change }
    let mode: Mode
    @Environment(PlaceSearch.self) private var search
    @Environment(LocationService.self) private var location
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var query = ""
    @State private var locating = false
    @State private var notice: UserFacingError?
    @FocusState private var focused: Bool
    private let examples = ["San Francisco", "Coffee in Chicago", "Central Park, New York", "Tempe, Arizona"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    OracleWordmark()
                    Spacer()
                    if case .change = mode {
                        Button("Close") { dismiss() }.font(.bold(.body)).foregroundStyle(Ink.blue).frame(minHeight: 44)
                    }
                }
                OraHero(title: "where to?", message: "Pick an area and I’ll show real places there. Browsing never checks you in.", oraSize: 96)
                Text("Choose your area").font(.display(.title)).foregroundStyle(Ink.charcoal)

                Button { useLocation() } label: {
                    HStack(spacing: 10) {
                        if locating { ProgressView().tint(Ink.charcoal) } else { Image(systemName: "location.fill") }
                        Text(locating ? "Finding you…" : "Use my location")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.chunky(Ink.butter))
                .disabled(locating)

                if location.denied {
                    NoticeCard(kind: .info, title: "Location access is off",
                               message: "That’s fine. Search for a city or venue below. You can allow location later in iPhone Settings → Oracle.")
                } else if let notice {
                    NoticeCard(kind: .error, title: notice.title, message: notice.message)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Or search a city or venue").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                    HStack(spacing: 8) {
                        InkField(title: "City, neighborhood or venue", text: $query, symbol: "magnifyingglass")
                            .focused($focused)
                            .submitLabel(.search)
                            .onSubmit { choose(query) }
                        Button { choose(query) } label: { Image(systemName: "arrow.right").frame(width: 24) }
                            .buttonStyle(.chunky(Ink.blue, text: .white, height: 50))
                            .disabled(query.trimmingCharacters(in: .whitespaces).isEmpty)
                            .accessibilityLabel("Search")
                    }
                    FlowChips(items: examples) { choose($0) }
                }
                if location.denied {
                    Button("Open iPhone Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
                        .font(.bold(.subheadline)).foregroundStyle(Ink.blue).frame(minHeight: 44)
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(DotBackground())
    }

    private func useLocation() {
        notice = nil
        locating = true
        Task {
            defer { locating = false }
            do {
                let here = try await location.current()
                search.searchNearby(here)
                done()
            } catch LocationService.LocationError.denied {
                notice = nil
            } catch {
                notice = UserFacingError.from(error, context: "first location")
                if notice?.kind != .location {
                    notice = .init(kind: .location, title: "Couldn’t find your location", message: "Search for a city or venue instead.")
                }
            }
        }
    }
    private func choose(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        focused = false
        search.search(clean)
        done()
    }
    private func done() {
        switch mode {
        case .firstUse(let finish): withAnimation { finish() }
        case .change: dismiss()
        }
    }
}

struct FlowChips: View {
    let items: [String]
    let action: (String) -> Void
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { chips }
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) { ForEach(items.prefix(2), id: \.self, content: chip) }
                HStack(spacing: 8) { ForEach(items.dropFirst(2), id: \.self, content: chip) }
            }
        }
    }
    @ViewBuilder private var chips: some View { ForEach(items, id: \.self, content: chip) }
    private func chip(_ item: String) -> some View {
        Button { action(item) } label: { Chip(text: item, symbol: "magnifyingglass").frame(minHeight: 44) }
            .buttonStyle(SquishStyle())
    }
}
