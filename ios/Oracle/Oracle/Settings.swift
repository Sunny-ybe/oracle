import SwiftUI
import MapKit
import SafariServices
import AuthenticationServices

// MARK: - Settings

struct SettingsScreen: View {
    @Environment(OracleSession.self) private var session
    @Environment(Router.self) private var router
    @Environment(PlaceSearch.self) private var search
    @Environment(LocationService.self) private var location
    @Environment(\.openURL) private var openURL
    @AppStorage("oracle.appleID") private var appleID = ""
    @AppStorage("oracle.appleName") private var appleName = ""
    @AppStorage("oracle.onboarded") private var onboarded = true
    @AppStorage("oracle.sample.points") private var samplePoints = 0
    @AppStorage("oracle.sounds.enabled") private var soundsEnabled = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Settings").font(.display(.largeTitle)).foregroundStyle(Ink.charcoal)

                TagCard(tag: "Oracle account", color: Ink.mint) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 10) {
                            Circle().fill(statusColor).frame(width: 12, height: 12).overlay(Circle().strokeBorder(Ink.charcoal, lineWidth: 1.5))
                            Text(statusText).font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                        }
                        Text("Needed to check in, answer requests and earn points. Your session is stored in the iPhone Keychain.")
                            .font(.soft(.caption)).foregroundStyle(Ink.muted)
                        Button(session.isConnected ? "Manage account" : "Sign in to Oracle") { router.present(.account) }
                            .buttonStyle(.chunky(session.isConnected ? Ink.paper : Ink.blue, text: session.isConnected ? Ink.charcoal : .white, height: 44))
                    }
                }

                TagCard(tag: "Device profile · Sign in with Apple", color: Ink.periwinkle) {
                    VStack(alignment: .leading, spacing: 10) {
                        if appleID.isEmpty {
                            SignInWithAppleButton(.signIn) { $0.requestedScopes = [.fullName] } onCompletion: { result in
                                if case .success(let auth) = result, let credential = auth.credential as? ASAuthorizationAppleIDCredential {
                                    appleID = credential.user
                                    if let first = credential.fullName?.givenName { appleName = first }
                                }
                            }
                            .signInWithAppleButtonStyle(.black).frame(height: 44).clipShape(RoundedRectangle(cornerRadius: 12))
                        } else {
                            Text(appleName.isEmpty ? "Signed in with Apple" : "Signed in with Apple as \(appleName)").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                            Button("Remove from this iPhone") { appleID = ""; appleName = "" }.buttonStyle(.chunky(Ink.paper, height: 40))
                        }
                        Text("Only personalizes this iPhone. It is not an Oracle account and can’t receive requests or points.")
                            .font(.soft(.caption)).foregroundStyle(Ink.muted)
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Toggle(isOn: $soundsEnabled) {
                        Label("Sound effects", systemImage: "speaker.wave.2.fill").font(.bold(.headline))
                    }
                    .tint(Ink.blue).accessibilityIdentifier("soundEffectsToggle")
                    Text("Soft taps and reward chimes. Follows Silent Mode and pauses during microphone use.")
                        .font(.soft(.caption)).foregroundStyle(Ink.muted)
                    Button { AppSounds.shared.play(.hello) } label: { Label("Try a sound", systemImage: "play.fill") }
                        .font(.bold(.subheadline)).frame(minHeight: 44)
                        .disabled(!soundsEnabled).accessibilityIdentifier("previewSound")
                }
                .inkCard(fill: Ink.paper, padding: 14)
                .onChange(of: soundsEnabled) { _, enabled in
                    if enabled { AppSounds.shared.play(.hello) } else { AppSounds.shared.stop() }
                }

                LiveLocationCard()

                TagCard(tag: "Area & location", color: Ink.butter) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(search.area.map { "Showing \($0.title)" } ?? "No area chosen").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                        Text(locationText).font(.soft(.caption)).foregroundStyle(Ink.muted)
                        HStack(spacing: 10) {
                            Button("Change area") { router.present(.location) }.buttonStyle(.chunky(Ink.butter, height: 42))
                            if location.denied {
                                Button("iPhone Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
                                    .buttonStyle(.chunky(Ink.paper, height: 42))
                            }
                        }
                    }
                }

                Button { router.present(.assistants) } label: { settingsRow("sparkles", Ink.periwinkle, "AI assistants", "Set up Claude or ChatGPT") }
                    .buttonStyle(SquishStyle())
                Button { router.present(.sample) } label: { settingsRow("play.fill", Ink.pink, "Try a sample", samplePoints > 0 ? "\(samplePoints) sample points · not real" : "A practice place and poll. Nothing is sent.") }
                    .buttonStyle(SquishStyle())

                TagCard(tag: "About maps", color: Ink.pinkSoft) {
                    Text("Maps and place search use Apple MapKit. “Open in Maps” opens the selected venue in Apple Maps. Venue photos come from your Oracle server (Google Places) and are labeled with their source.")
                        .font(.soft(.caption)).foregroundStyle(Ink.charcoal)
                }

                Button("Show the welcome screens again") { onboarded = false }
                    .font(.bold(.subheadline)).foregroundStyle(Ink.blue).frame(minHeight: 44)
            }
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
            .frame(maxWidth: 600).frame(maxWidth: .infinity)
        }
        .background(DotBackground())
        .toolbar(.hidden, for: .navigationBar)
    }

    private func settingsRow(_ symbol: String, _ fill: Color, _ title: String, _ subtitle: String) -> some View {
        HStack(spacing: 12) {
            IconBadge(symbol: symbol, fill: fill)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                Text(subtitle).font(.soft(.caption)).foregroundStyle(Ink.muted)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.subheadline.weight(.heavy)).foregroundStyle(Ink.charcoal)
        }
        .inkCard(shadow: 4, padding: 12)
    }

    private var statusText: String {
        switch session.state {
        case .connected: "Connected as \(session.account?.name ?? "you")"
        case .checking: "Checking your session…"
        case .expired: "Session expired · sign in again"
        case .unreachable: "Server unreachable"
        case .signedOut: session.hasServer ? "Not signed in" : "Not connected"
        }
    }
    private var statusColor: Color {
        switch session.state {
        case .connected: Ink.mint
        case .checking: Ink.butter
        default: Ink.pink
        }
    }
    private var locationText: String {
        switch location.status {
        case .authorizedAlways, .authorizedWhenInUse: "Location allowed while using Oracle. It’s used for Near me, and for Live location if you turn it on."
        case .denied, .restricted: "Location is off. Search for any city or venue instead."
        default: "Location not requested yet."
        }
    }
}

// MARK: - Oracle account

struct AccountScreen: View {
    @Environment(OracleSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var server = ""
    @State private var testing = false
    @State private var serverError: UserFacingError?
    @State private var register = false
    @State private var username = ""
    @State private var password = ""
    @State private var first = ""
    @State private var last = ""
    @State private var busy = false
    @State private var authError: UserFacingError?
    @State private var editing = false
    @FocusState private var field: Field?
    private enum Field { case server, first, last, username, password }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    serverCard
                    if session.isConnected { accountCard } else if session.hasServer { signInCard }
                    Text("Oracle accounts live on your Oracle server. Sign in with Apple is a separate, device-only profile.")
                        .font(.soft(.caption)).foregroundStyle(Ink.muted)
                }
                .padding(20)
                .frame(maxWidth: 560).frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(DotBackground())
            .navigationTitle("Oracle account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.font(.bold(.body)) }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { field = nil }.font(.bold(.body)) }
            }
            .onAppear { server = session.baseURL }
            .task { if session.hasServer, session.server == nil { await session.restore() } }
            .sheet(isPresented: $editing) { EditAccountScreen().environment(session) }
        }
    }

    private var serverCard: some View {
        TagCard(tag: "Server", color: Ink.periwinkle) {
            VStack(alignment: .leading, spacing: 10) {
                InkField(title: "https://your-oracle-server.com", text: $server, symbol: "server.rack")
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($field, equals: .server).submitLabel(.go).onSubmit(testServer)
                Button { testServer() } label: {
                    HStack { if testing { ProgressView().tint(Ink.charcoal) }; Text(testing ? "Checking…" : session.hasServer && server == session.baseURL ? "Check again" : "Connect server") }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.chunky(Ink.periwinkle, height: 44))
                .disabled(testing || server.trimmingCharacters(in: .whitespaces).isEmpty)
                if let serverError { NoticeCard(kind: .error, title: serverError.title, message: serverError.message) }
                if let info = session.server, session.hasServer {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Oracle server found", systemImage: "checkmark.circle.fill").font(.bold(.subheadline)).foregroundStyle(Ink.charcoal)
                        Text(integrations(info)).font(.soft(.caption)).foregroundStyle(Ink.muted)
                    }
                }
                Text("This is where your Oracle backend (the Node server) is running. On the Simulator, use http://localhost:3000. On a real iPhone, localhost won’t work: use your server’s https:// link, like your tunnel or domain.")
                    .font(.soft(.caption)).foregroundStyle(Ink.muted)
            }
        }
    }

    private var signInCard: some View {
        TagCard(tag: register ? "Create an Oracle account" : "Sign in", color: Ink.mint) {
            VStack(alignment: .leading, spacing: 10) {
                Picker("Mode", selection: $register) { Text("Sign in").tag(false); Text("Create account").tag(true) }
                    .pickerStyle(.segmented)
                if session.state == .expired { Text("Your session ended. Sign in again.").font(.bold(.subheadline)).foregroundStyle(Ink.danger) }
                if register {
                    InkField(title: "First name", text: $first).textContentType(.givenName).focused($field, equals: .first).submitLabel(.next).onSubmit { field = .last }
                    InkField(title: "Last name", text: $last).textContentType(.familyName).focused($field, equals: .last).submitLabel(.next).onSubmit { field = .username }
                }
                InkField(title: "Username", text: $username, symbol: "person")
                    .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($field, equals: .username).submitLabel(.next).onSubmit { field = .password }
                InkField(title: "Password", text: $password, symbol: "lock", secure: true)
                    .textContentType(register ? .newPassword : .password)
                    .focused($field, equals: .password).submitLabel(.go).onSubmit(signIn)
                if let authError { NoticeCard(kind: .error, title: authError.title, message: authError.message) }
                Button { signIn() } label: {
                    HStack { if busy { ProgressView().tint(.white) }; Text(busy ? "Connecting…" : register ? "Create account" : "Sign in") }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.chunky(Ink.blue, text: .white))
                .accessibilityIdentifier("submitSignIn")
                .disabled(busy || username.isEmpty || password.isEmpty || (register && (first.isEmpty || last.isEmpty)))
                SocialSignInButtons()
            }
        }
    }

    private var accountCard: some View {
        TagCard(tag: "Connected", color: Ink.mint) {
            VStack(alignment: .leading, spacing: 10) {
                Text(session.account?.name ?? "").font(.display(.title2)).foregroundStyle(Ink.charcoal)
                if let username = session.account?.username { Text("@\(username)").font(.soft(.subheadline)).foregroundStyle(Ink.muted) }
                Text("\(session.account?.credits ?? 0) points").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                HStack(spacing: 10) {
                    Button { editing = true } label: { Label("Edit account", systemImage: "pencil").frame(maxWidth: .infinity) }
                        .buttonStyle(.chunky(Ink.periwinkle, height: 44))
                    Button("Sign out", role: .destructive) { session.signOut(); password = "" }
                        .buttonStyle(.chunky(Ink.pink, height: 44))
                }
            }
        }
    }

    private func integrations(_ info: ServerConfig) -> String {
        let i = info.integrations
        let on = [("Gemini", i?.gemini), ("venue photos", i?.venuePhotos), ("Telegram", i?.telegram), ("Discord", i?.discord), ("Solana devnet", i?.solanaDevnet)]
        let enabled = on.filter { $0.1 == true }.map(\.0)
        return enabled.isEmpty ? "No optional integrations are switched on." : "Switched on: " + enabled.joined(separator: ", ")
    }

    private func testServer() {
        field = nil
        serverError = nil
        testing = true
        Task {
            defer { testing = false }
            do { try await session.connectServer(server) }
            catch { serverError = UserFacingError.from(error, context: "connect server") }
        }
    }

    private func signIn() {
        guard !busy, !username.isEmpty, !password.isEmpty else { return }
        field = nil
        busy = true
        authError = nil
        Task {
            defer { busy = false }
            do {
                try await session.signIn(username: username, password: password, first: first, last: last, register: register)
                password = ""
                dismiss()
            } catch {
                authError = UserFacingError.from(error, context: "sign in")
            }
        }
    }
}

// MARK: - AI assistants

/// Each provider owns the approval flow. Opening setup is never treated as a verified connection.
enum OracleAssistant: String, CaseIterable, Identifiable {
    case claude = "Claude", chatGPT = "ChatGPT"
    var id: String { rawValue }
    var logo: String { self == .claude ? "ClaudeLogo" : "ChatGPTLogo" }
    var appStoreURL: URL {
        URL(string: self == .claude ? "https://apps.apple.com/app/claude-by-anthropic/id6473753684" : "https://apps.apple.com/app/chatgpt/id6448311069")!
    }
    var guideURL: URL {
        URL(string: self == .claude
            ? "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
            : "https://developers.openai.com/api/docs/guides/custom-mcp-server")!
    }
    func setupURL(endpoint: String) -> URL {
        guard self == .claude else { return URL(string: "https://chatgpt.com/plugins")! }
        var url = URLComponents(string: "https://claude.ai/customize/connectors")!
        url.queryItems = [URLQueryItem(name: "modal", value: "add-custom-connector"),
                         URLQueryItem(name: "connectorName", value: "Oracle"),
                         URLQueryItem(name: "connectorUrl", value: endpoint)]
        return url.url!
    }
}

/// Local network addresses work for the native app, but cloud assistants cannot reach them.
enum AssistantEndpoint {
    static func isPublic(_ raw: String) -> Bool {
        guard let url = URLComponents(string: raw), url.scheme == "https",
              let host = url.host?.lowercased(), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.port == nil || url.port == 443 else { return false }
        if host == "localhost" || host == "::1" || host == "0.0.0.0" || host.hasSuffix(".localhost") || host.hasSuffix(".local") || !host.contains(".") { return false }
        if host.hasPrefix("fc") && host.contains(":") || host.hasPrefix("fd") && host.contains(":") || host.hasPrefix("fe80:") { return false }
        let octets = host.split(separator: ".").compactMap { Int($0) }
        if octets.count == 4 {
            if octets[0] == 10 || octets[0] == 127 || octets[0] == 0 || octets[0] >= 224 { return false }
            if octets[0] == 192 && octets[1] == 168 || octets[0] == 172 && (16...31).contains(octets[1]) || octets[0] == 169 && octets[1] == 254 { return false }
        }
        return true
    }
}

struct AssistantLogo: View {
    let assistant: OracleAssistant
    var size: CGFloat = 92
    var body: some View {
        Image(assistant.logo).resizable().scaledToFit().padding(size * 0.13)
            .frame(width: size, height: size).background(.white, in: RoundedRectangle(cornerRadius: size * 0.26))
            .accessibilityHidden(true)
    }
}

struct AssistantConnection: View {
    @Environment(OracleSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selected = OracleAssistant.claude
    @State private var browser: AssistantBrowser?
    @State private var serverSettings = false
    @State private var copied = false
    @State private var details = false

    private var endpoint: String {
        if let configured = session.server?.mcp?.url, !configured.isEmpty { return configured }
        guard session.hasServer else { return "" }
        return session.baseURL + (session.server?.mcp?.path ?? "/mcp")
    }
    private var publicEndpoint: Bool { AssistantEndpoint.isPublic(endpoint) }
    private var authKnown: Bool { session.server?.mcp?.auth != nil }
    private var keyRequired: Bool { session.server?.mcp?.auth == "api-key" }
    private var oauth: Bool { session.server?.mcp?.oauth == true }

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $selected) {
                ForEach(OracleAssistant.allCases) { assistant in
                    ScrollView {
                        slide(assistant)
                            .padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 20)
                            .frame(maxWidth: 560).frame(maxWidth: .infinity)
                    }
                    .tag(assistant)
                    .accessibilityIdentifier(assistant == .claude ? "claudeSlide" : "chatGPTSlide")
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .accessibilityIdentifier("assistantPages")
            HStack(spacing: 12) {
                ForEach(OracleAssistant.allCases) { assistant in
                    Button { select(assistant) } label: {
                        HStack(spacing: 7) {
                            Circle().fill(selected == assistant ? Ink.blue : Ink.muted.opacity(0.25)).frame(width: 7, height: 7)
                            Text(assistant.rawValue).font(selected == assistant ? .bold(.subheadline) : .soft(.subheadline))
                        }
                        .foregroundStyle(selected == assistant ? Ink.blue : Ink.muted)
                        .padding(.horizontal, 12).frame(minHeight: 44)
                    }
                    .accessibilityLabel("Show " + assistant.rawValue)
                    .accessibilityAddTraits(selected == assistant ? .isSelected : [])
                }
            }
            .padding(.bottom, 6)
        }
        .background(DotBackground())
        .navigationTitle("AI assistants")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.font(.bold(.body)) } }
        .sheet(item: $browser) { SafariView(url: $0.url).ignoresSafeArea() }
        .sheet(isPresented: $serverSettings) { AccountScreen() }
        .task { await session.restore() }
        .onChange(of: selected) { _, _ in copied = false; details = false }
    }

    private func select(_ assistant: OracleAssistant) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { selected = assistant }
    }

    private func slide(_ assistant: OracleAssistant) -> some View {
        let requiresSetup = !publicEndpoint || !authKnown || (assistant == .chatGPT && keyRequired && !oauth)
        return VStack(alignment: .leading, spacing: 23) {
            VStack(spacing: 14) {
                AssistantLogo(assistant: assistant)
                Text("Ask with " + assistant.rawValue).font(.display(.largeTitle)).foregroundStyle(Ink.charcoal)
                    .accessibilityIdentifier(assistant == .claude ? "claudeTitle" : "chatGPTTitle")
                Text("Your AI asks.\nPeople nearby answer.")
                    .font(.soft(.title3)).foregroundStyle(Ink.muted).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 17) {
                step("1", assistant == .claude ? "Open Oracle’s connector setup in Claude." : "Open ChatGPT Plugins. Tap +, then Add custom MCP server.")
                step("2", assistant == .claude ? "Review the Oracle name and server address, then approve adding it." : "Name it Oracle, paste the server address, then create and install the plugin.")
                step("3", assistant == .claude ? "Enable Oracle in your chat and ask about a place." : "In a new chat, type @ and choose Oracle. Ask about a place.")
            }

            if !publicEndpoint {
                Text("Oracle needs a public HTTPS server before an AI assistant can reach it. Your current server is local or not configured.")
                    .font(.soft(.subheadline)).foregroundStyle(Ink.muted)
                    .accessibilityIdentifier("assistantLocalServer")
            } else if assistant == .chatGPT && keyRequired && !oauth {
                Text("This server uses an API key. ChatGPT needs a compatible OAuth sign-in service before it can connect. Ask your server operator to configure it.")
                    .font(.soft(.subheadline)).foregroundStyle(Ink.muted)
                    .accessibilityIdentifier("assistantAuthBlocked")
            } else if !authKnown {
                Text("Check your Oracle server in Settings to load its connection requirements.")
                    .font(.soft(.subheadline)).foregroundStyle(Ink.muted)
            }

            VStack(spacing: 10) {
                Button {
                    if requiresSetup {
                        serverSettings = true
                    } else {
                        UIPasteboard.general.string = endpoint
                        copied = true
                        browser = AssistantBrowser(url: assistant.setupURL(endpoint: endpoint))
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text(requiresSetup ? "Configure server" : "Connect " + assistant.rawValue)
                        Image(systemName: requiresSetup ? "gearshape" : "arrow.up.right")
                    }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.chunky(assistant == .claude ? Ink.butter : Ink.mint))
                .accessibilityIdentifier(assistant == .claude ? "connectClaude" : "connectChatGPT")
                Text("Setup opens on the web. You approve the connection there.")
                    .font(.soft(.caption)).foregroundStyle(Ink.muted).multilineTextAlignment(.center)
                Link("Need the app? Get " + assistant.rawValue, destination: assistant.appStoreURL)
                    .font(.bold(.subheadline)).frame(minHeight: 44)
            }

            DisclosureGroup("Server address & help", isExpanded: $details) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(endpoint.isEmpty ? "Add your Oracle server in Settings." : endpoint)
                        .font(.footnote.monospaced()).foregroundStyle(Ink.charcoal).textSelection(.enabled)
                    if !endpoint.isEmpty {
                        Button {
                            UIPasteboard.general.string = endpoint; copied = true
                        } label: { Label(copied ? "Address copied" : "Copy server address", systemImage: copied ? "checkmark" : "doc.on.doc") }
                            .font(.bold(.subheadline)).frame(minHeight: 44)
                            .accessibilityIdentifier("copyAssistantAddress")
                        ShareLink(item: endpoint) { Label("Share address", systemImage: "square.and.arrow.up") }
                            .font(.bold(.subheadline)).frame(minHeight: 44)
                    }
                    Text(authHelp(for: assistant)).font(.soft(.caption)).foregroundStyle(Ink.muted)
                    Text(assistant == .claude ? "If setup opens without the form, sign in and choose Customize → Connectors → Add custom connector. Paste the copied address. Team members may need their owner to add it first." : "Custom MCP setup uses ChatGPT on the web. Availability depends on your account and workspace permissions.")
                        .font(.soft(.caption)).foregroundStyle(Ink.muted)
                    Link("Open " + assistant.rawValue + " setup guide", destination: assistant.guideURL)
                        .font(.bold(.subheadline)).frame(minHeight: 44)
                    Text("The connection is managed in your assistant. Oracle cannot verify whether you finished adding it.")
                        .font(.soft(.caption)).foregroundStyle(Ink.muted)
                }.padding(.top, 12)
            }
            .font(.bold(.subheadline)).tint(Ink.blue)
        }
    }

    private func authHelp(for assistant: OracleAssistant) -> String {
        if oauth { return "Choose OAuth and finish sign-in in your assistant." }
        if !authKnown { return "Check the server in Settings to load its authentication requirements." }
        if !keyRequired { return "This server accepts requests without sign-in. Select No sign-in / No authentication only if you trust its operator." }
        if assistant == .claude { return "Choose No sign-in, then add the x-oracle-key request header using the key supplied by your server operator. Enter it only in Claude, never in shared links." }
        return "ChatGPT supports OAuth or no authentication. This API-key-only server needs an OAuth gateway; never put its key into the URL."
    }

    private func step(_ n: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(n).font(.bold(.caption)).frame(width: 27, height: 27).inkOutline(13.5, fill: Ink.paper, line: 1.5)
            Text(text).font(.soft(.subheadline)).foregroundStyle(Ink.charcoal).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct AssistantBrowser: Identifiable {
    let id = UUID()
    let url: URL
}

// MARK: - Sample (clearly labeled, local only)

struct SampleExperience: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("oracle.sample.points") private var samplePoints = 0
    @State private var selected = SampleExperience.places[0]
    @State private var answer: Int?
    @State private var answered = false
    @State private var camera = MapCameraPosition.tilted(.init(latitude: 33.4182, longitude: -111.9344), distance: 750)
    @State private var measuring = false
    @State private var noiseDb: Int?
    @State private var success: Contribution?

    static let places = [
        NearbyPlace(id: "sample-library", name: "Hayden Library (sample)", lat: 33.4188, lng: -111.9349, kind: "library", tagline: "Sample place", isSample: true),
        NearbyPlace(id: "sample-union", name: "Memorial Union (sample)", lat: 33.4176, lng: -111.9346, kind: "food", tagline: "Sample place", isSample: true),
        NearbyPlace(id: "sample-pavilion", name: "Student Pavilion (sample)", lat: 33.418, lng: -111.9338, kind: "events", tagline: "Sample place", isSample: true),
    ]
    private let options = ["Empty", "Some space", "Packed"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    NoticeCard(kind: .sample, title: "Sample · nothing here is real", message: "Practice places around ASU in Tempe, Arizona. Answers stay on this iPhone, and sample points are separate from your Oracle points.")
                    Map(position: $camera, interactionModes: [.pan, .zoom, .rotate, .pitch]) {
                        ForEach(Self.places) { place in
                            Annotation(place.name, coordinate: place.coordinate, anchor: .bottom) {
                                PlacePin(place: place, selected: place.id == selected.id) { selected = place; answer = nil; answered = false }
                            }
                            .annotationTitles(.hidden)
                        }
                    }
                    .mapStyle(.standard(elevation: .realistic))
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: Ink.line))
                    TagCard(tag: "Sample poll · \(selected.name)", color: Ink.mint) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("How crowded is it right now?").font(.display(.title3)).foregroundStyle(Ink.charcoal)
                            ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                                Button { answer = index } label: {
                                    HStack { Text(option).font(.bold(.headline)); Spacer(); Image(systemName: answer == index ? "checkmark.circle.fill" : "circle") }
                                        .foregroundStyle(Ink.charcoal).padding(.horizontal, 14).frame(minHeight: 50)
                                        .inkOutline(14, fill: answer == index ? Ink.mint : Ink.paper)
                                }
                                .buttonStyle(SquishStyle()).disabled(answered)
                            }
                            Button { measuring = true } label: {
                                Label(noiseDb.map { "Noise: \($0) dB · \(NoiseLevel(db: Double($0)).title)" } ?? "Measure noise (optional)", systemImage: "waveform")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.chunky(Ink.butter, height: 44))
                            .disabled(answered)
                            Button(answered ? "Sample answer saved" : "Submit sample answer") {
                                answered = true
                                samplePoints += 1
                                success = Contribution(place: selected.name, answer: answer.map { options[$0] }, noiseDb: noiseDb, points: 1, isSample: true)
                            }
                            .buttonStyle(.chunky(Ink.blue, text: .white))
                            .disabled(answer == nil || answered)
                            if answered { Text("+1 sample point. Real requests come from AI agents once you sign in and check in.").font(.soft(.caption)).foregroundStyle(Ink.muted) }
                        }
                    }
                    HStack {
                        Chip(text: "\(samplePoints) sample points", symbol: "sparkles", fill: Ink.butterSoft)
                        Spacer()
                        Button("Reset sample") { samplePoints = 0; answered = false; answer = nil; noiseDb = nil }.font(.bold(.subheadline)).frame(minHeight: 44)
                    }
                }
                .padding(20)
                .frame(maxWidth: 600).frame(maxWidth: .infinity)
            }
            .background(DotBackground())
            .navigationTitle("Try a sample")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.font(.bold(.body)) } }
            .fullScreenCover(isPresented: $measuring) { MeasureNoiseScreen(placeName: selected.name) { noiseDb = $0 } }
            .fullScreenCover(item: $success) { contribution in
                ContributionSuccessView(contribution: contribution, onImpact: { success = nil }, onDone: { success = nil })
            }
        }
    }
}

// MARK: - Safari (web capture handoff)

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.dismissButtonStyle = .close
        return controller
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
