import SwiftUI
import MapKit

// MARK: - Venue imagery

/// Venue photo with attribution. Google photos are labeled as venue imagery; Oracle contributor photos are
/// labeled as privacy-masked evidence with their capture time. Missing photos show an illustration.
struct VenueImage: View {
    let place: NearbyPlace
    let media: VenueMedia?
    let loading: Bool
    @Environment(OracleSession.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottomLeading) {
                // Opaque base: the offset shadow sits behind this frame and must not show through.
                Rectangle().fill(Ink.cream)
                Rectangle().fill(place.tint.opacity(0.45))
                if let raw = media?.url, let url = session.absoluteURL(raw) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image): image.resizable().scaledToFill()
                        case .failure: VenueSnapshotFill(place: place) { illustration }
                        default: ProgressView().tint(Ink.charcoal)
                        }
                    }
                } else if loading {
                    ProgressView().tint(Ink.charcoal)
                } else {
                    // No server photo: Apple's Look Around street view, or a 3D satellite view.
                    VenueSnapshotFill(place: place) { illustration }
                }
                if let label {
                    Chip(text: label, symbol: media?.source == "oracle" ? "person.crop.circle.badge.checkmark" : "photo", fill: Ink.paper)
                        .padding(10)
                }
            }
            .frame(height: 180)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Ink.charcoal, lineWidth: Ink.line))
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Ink.charcoal).offset(x: 5, y: 5))
            .padding(.trailing, 5).padding(.bottom, 5)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText)
            attribution
        }
    }

    private var illustration: some View {
        VStack(spacing: 6) {
            Image(systemName: place.symbol).font(.system(size: 46, weight: .bold)).foregroundStyle(Ink.charcoal)
            Text("No photo yet").font(.bold(.caption)).foregroundStyle(Ink.charcoal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var label: String? {
        switch media?.source {
        case "google": "Venue photo"
        case "oracle": "Contributor photo"
        case "wikimedia": "Wikimedia Commons"
        default: nil
        }
    }

    @ViewBuilder private var attribution: some View {
        if media?.source == "google" {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text("Photo: Google Maps").font(.soft(.caption2))
                    ForEach(media?.authors ?? [], id: \.self) { author in
                        if let name = author.name {
                            if let raw = author.uri, let url = URL(string: raw.hasPrefix("//") ? "https:" + raw : raw) {
                                Link("· \(name)", destination: url).font(.bold(.caption2))
                            } else { Text("· \(name)").font(.soft(.caption2)) }
                        }
                    }
                }
                Text("Venue imagery from Google. It doesn’t show current conditions.").font(.soft(.caption2))
            }
            .foregroundStyle(Ink.muted)
        } else if media?.source == "wikimedia" {
            let credit = ["Photo", media?.author, media?.license].compactMap { $0 }.joined(separator: " · ")
            Group {
                if let raw = media?.pageUrl, let url = URL(string: raw) { Link("\(credit) · Wikimedia Commons", destination: url).font(.bold(.caption2)) }
                else { Text("\(credit) · Wikimedia Commons").font(.soft(.caption2)) }
            }
            .foregroundStyle(Ink.muted)
        } else if media?.source == "oracle" {
            Text("Shared by an Oracle contributor\(ISO8601.relative(media?.capturedAt).map { " \($0)" } ?? ""). Faces, badges, screens and plates are blurred.")
                .font(.soft(.caption2)).foregroundStyle(Ink.muted)
        }
    }

    private var accessibilityText: String {
        switch media?.source {
        case "google": "Venue photo of \(place.name) from Google Maps"
        case "oracle": "Privacy-masked contributor photo of \(place.name)"
        case "wikimedia": "Photo of \(place.name) from Wikimedia Commons"
        default: "Apple Maps view of \(place.name)"
        }
    }
}

// MARK: - Place details

struct PlaceScreen: View {
    let place: NearbyPlace
    let tab: AppTab
    @Environment(OracleSession.self) private var session
    @Environment(Router.self) private var router
    @State private var media: VenueMedia?
    @State private var mediaLoading = false
    @State private var report: PlaceReport?
    @State private var reportError: UserFacingError?
    @State private var confirmingCheckIn = false
    @State private var checkingIn = false
    @State private var checkInResult: String?
    @State private var checkInError: UserFacingError?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VenueImage(place: place, media: media, loading: mediaLoading)
                VStack(alignment: .leading, spacing: 6) {
                    Text(place.name).font(.display(.largeTitle)).foregroundStyle(Ink.charcoal).fixedSize(horizontal: false, vertical: true)
                    if !place.subtitle.isEmpty { Text(place.subtitle).font(.soft(.subheadline)).foregroundStyle(Ink.muted) }
                    HStack(spacing: 8) {
                        Chip(text: place.isOracleKnown ? "On Oracle" : "Apple Maps place", symbol: place.isOracleKnown ? "checkmark.seal.fill" : "map", fill: place.isOracleKnown ? Ink.mintSoft : Ink.periSoft)
                        if let people = report?.people_here ?? place.people_here, people > 0 { Chip(text: "\(people) checked in", symbol: "person.2.fill", fill: Ink.butterSoft) }
                    }
                }
                latestReport
                checkIn
                links
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .frame(maxWidth: 600).frame(maxWidth: .infinity)
        }
        .background(DotBackground())
        .navigationTitle("Place")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task(id: place.id) { await load() }
    }

    @ViewBuilder private var latestReport: some View {
        TagCard(tag: "Latest from people there", color: Ink.mint) {
            if let headline = report?.headline ?? place.headline, let answer = headline.answer {
                VStack(alignment: .leading, spacing: 6) {
                    Text(headline.question ?? "Latest report").font(.soft(.subheadline)).foregroundStyle(Ink.muted)
                    Text(answer).font(.display(.title2)).foregroundStyle(Ink.charcoal)
                    Text([headline.source.map { "Source: \($0)" }, ISO8601.relative(headline.at), headline.votes.map { "\($0) votes" }].compactMap { $0 }.joined(separator: " · "))
                        .font(.soft(.caption)).foregroundStyle(Ink.muted)
                }
            } else if let reportError {
                VStack(alignment: .leading, spacing: 8) {
                    Text(reportError.message).font(.soft(.subheadline)).foregroundStyle(Ink.charcoal)
                    Button("Retry") { Task { await loadReport() } }.buttonStyle(.chunky(Ink.mint, height: 38))
                }
            } else {
                Text(place.isOracleKnown ? "No recent answers. When an AI agent asks about this place, people checked in nearby answer here." : "No Oracle reports yet. An AI agent can ask people near this place.")
                    .font(.soft(.subheadline)).foregroundStyle(Ink.charcoal)
            }
        }
    }

    @ViewBuilder private var checkIn: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !session.isConnected {
                NoticeCard(kind: .info, title: "Want to answer questions here?", message: "Sign in to an Oracle account, then check in to receive requests about this area.",
                           actionTitle: "Sign in") { router.present(.account) }
            } else if session.account?.place == place.name {
                NoticeCard(kind: .success, title: "You’re checked in here", message: "New requests appear in the Requests tab.",
                           actionTitle: "Open Requests") { router.select(.requests) }
            } else if confirmingCheckIn {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Check in at \(place.name)?").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                    Text("Only check in if you’re here now. Oracle will send you questions about this place and nearby places.").font(.soft(.subheadline)).foregroundStyle(Ink.muted)
                    HStack(spacing: 10) {
                        Button("Cancel") { confirmingCheckIn = false }.buttonStyle(.chunky(Ink.paper, height: 44))
                        Button { performCheckIn() } label: {
                            HStack { if checkingIn { ProgressView().tint(Ink.charcoal) }; Text(checkingIn ? "Checking in…" : "Yes, I’m here") }.frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.chunky(Ink.mint, height: 44))
                        .disabled(checkingIn)
                    }
                }
                .inkCard(fill: Ink.mintSoft)
            } else {
                Button { confirmingCheckIn = true } label: { Label("I’m here · get requests", systemImage: "location.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.chunky(Ink.mint))
                Text("Browsing never checks you in. Checking in, or turning on Live location, is always your choice.").font(.soft(.caption)).foregroundStyle(Ink.muted)
            }
            if let checkInResult { NoticeCard(kind: .success, title: "Checked in", message: checkInResult) }
            if let checkInError { NoticeCard(kind: .error, title: checkInError.title, message: checkInError.message, actionTitle: "Retry") { performCheckIn() } }
        }
    }

    private var links: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button { place.openInAppleMaps() } label: { Label("Open in Maps", systemImage: "map").frame(maxWidth: .infinity) }
            .buttonStyle(.chunky(Ink.paper))
            if let website = place.website, let url = URL(string: website) {
                Link(destination: url) { Label("Website", systemImage: "safari").font(.bold(.subheadline)).frame(minHeight: 44) }
            }
            if let phone = place.phone, let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                Link(destination: url) { Label(phone, systemImage: "phone.fill").font(.bold(.subheadline)).frame(minHeight: 44) }
            }
        }
    }

    private func load() async {
        async let r: Void = loadReport()
        async let m: Void = loadMedia()
        _ = await (r, m)
    }

    private func loadReport() async {
        // Browsing only reads. It never registers or checks in at the place.
        guard place.isOracleKnown, session.hasServer else { return }
        reportError = nil
        do { report = try await session.request("api/app/place/\(place.id)") }
        catch { reportError = UserFacingError.from(error, context: "place report") }
    }

    private func loadMedia() async {
        guard session.hasServer else { return }  // public: contributor / Wikimedia photos show before signing in
        mediaLoading = true
        defer { mediaLoading = false }
        do {
            media = try await session.request("api/app/venue-media", body: ["placeId": place.id, "name": place.name, "lat": place.lat, "lng": place.lng])
        } catch {
            _ = UserFacingError.from(error, context: "venue media")
        }
    }

    private func performCheckIn() {
        guard !checkingIn else { return }
        checkingIn = true
        checkInError = nil
        Task {
            defer { checkingIn = false }
            do {
                struct Ensured: Decodable { let id: String }
                var placeID = place.id
                if !place.isOracleKnown {
                    let ensured: Ensured = try await session.request("api/places/ensure", body: ["name": place.name, "lat": place.lat, "lng": place.lng, "kind": place.kind ?? "place"])
                    placeID = ensured.id
                }
                let result: ServerMessage = try await session.request("api/app/checkin", body: ["place": placeID])
                guard result.ok == true else { throw APIError.server(result.message ?? "Check-in didn’t go through.") }
                try await session.refreshAccount()
                confirmingCheckIn = false
                checkInResult = "You’ll get requests about \(place.name) and places nearby in the Requests tab."
            } catch {
                checkInError = UserFacingError.from(error, context: "check in")
            }
        }
    }
}

// MARK: - Requests

struct RequestsScreen: View {
    @Environment(OracleSession.self) private var session
    @Environment(Router.self) private var router
    @State private var loadError: UserFacingError?
    @State private var refreshing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Answer").font(.display(.largeTitle)).foregroundStyle(Ink.charcoal)
                    Text("& earn.").font(.display(.largeTitle)).foregroundStyle(Ink.blue)
                }
                Text("Check in where you are. Questions from AI agents about nearby places show up here.")
                    .font(.soft(.subheadline)).foregroundStyle(Ink.muted)
                content
            }
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
            .frame(maxWidth: 600).frame(maxWidth: .infinity)
        }
        .refreshable { await refresh() }
        .background(DotBackground())
        .toolbar(.hidden, for: .navigationBar)
        .task(id: router.tab == .requests && session.isConnected) {
            // Polls only while this tab is visible and signed in.
            guard router.tab == .requests, session.isConnected else { return }
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch session.state {
        case .checking:
            HStack(spacing: 10) { ProgressView().tint(Ink.charcoal); Text("Checking your Oracle account…").font(.soft(.subheadline)) }
                .frame(maxWidth: .infinity, alignment: .leading).inkCard()
        case .signedOut, .expired:
            VStack(alignment: .leading, spacing: 14) {
                OraHero(title: session.state == .expired ? "welcome back!" : "join in!",
                        message: session.state == .expired ? "Your Oracle session ended. Sign in again to see requests." : "Sign in to an Oracle account to receive requests and earn points.",
                        oraSize: 90)
                Button { router.present(.account) } label: { Label("Sign in", systemImage: "person.crop.circle.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.chunky(Ink.blue, text: .white))
                    .accessibilityIdentifier("requestsSignIn")
                Text("Sign in with Apple on this iPhone doesn’t create an Oracle account.").font(.soft(.caption)).foregroundStyle(Ink.muted)
            }
        case .unreachable(let message):
            NoticeCard(kind: .error, title: "Can’t reach Oracle", message: message, actionTitle: "Retry") { Task { await session.restore() } }
        case .connected:
            connected
        }
    }

    @ViewBuilder private var connected: some View {
        LiveLocationCard()
        checkInStatus
        if let loadError {
            NoticeCard(kind: .error, title: loadError.title, message: loadError.message, actionTitle: "Retry") { Task { await refresh() } }
        }
        let requests = session.account?.requests ?? []
        if requests.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "checkmark.bubble.fill").font(.system(size: 36, weight: .bold)).foregroundStyle(Ink.charcoal)
                Text("You’re all caught up").font(.display(.title3)).foregroundStyle(Ink.charcoal)
                Text("New questions appear here when an agent asks about a place near your check-in. Pull down to refresh.")
                    .font(.soft(.subheadline)).foregroundStyle(Ink.muted).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity).inkCard(fill: Ink.mintSoft)
        } else {
            SectionTitle(text: "\(requests.count) open request\(requests.count == 1 ? "" : "s")")
            ForEach(requests) { request in
                Button { router.present(.poll(request)) } label: { RequestCard(request: request) }
                    .buttonStyle(SquishStyle())
            }
        }
    }

    @ViewBuilder private var checkInStatus: some View {
        if let place = session.account?.place {
            HStack(spacing: 12) {
                IconBadge(symbol: "location.fill", fill: Ink.mint)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Checked in at \(place)").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                    Text("Check-ins expire after a day.").font(.soft(.caption)).foregroundStyle(Ink.muted)
                }
                Spacer()
            }
            .inkCard(fill: Ink.mintSoft, shadow: 4, padding: 12)
        } else {
            NoticeCard(kind: .info, title: "You’re not checked in", message: "Open a place you’re at and tap “I’m here” to start receiving its requests.",
                       actionTitle: "Find a place") { router.select(.explore) }
        }
    }

    private func refresh() async {
        guard session.isConnected, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        do { try await session.refreshAccount(); loadError = nil }
        catch { loadError = UserFacingError.from(error, context: "refresh requests") }
    }
}

private struct RequestCard: View {
    let request: OracleRequest
    var body: some View {
        TagCard(tag: request.place, color: Ink.mint) {
            VStack(alignment: .leading, spacing: 10) {
                Text(request.question).font(.display(.title3)).foregroundStyle(Ink.charcoal).multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    ForEach(request.options, id: \.self) { Chip(text: $0, fill: Ink.mintSoft) }
                }
                HStack {
                    if let label = request.sensorLabel { Chip(text: label, symbol: "camera.fill", fill: Ink.butterSoft) }
                    if let asked = request.askedDate { Text("Asked \(asked.formatted(.relative(presentation: .named)))").font(.soft(.caption)).foregroundStyle(Ink.muted) }
                    Spacer()
                    Text("Answer").font(.bold(.subheadline)).foregroundStyle(Ink.blue)
                    Image(systemName: "arrow.right").font(.subheadline.weight(.heavy)).foregroundStyle(Ink.blue)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the poll")
    }
}

// MARK: - Live poll

struct LivePoll: View {
    let request: OracleRequest
    @Environment(OracleSession.self) private var session
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    private enum Phase: Equatable { case choosing, sending, done(String), expired(String), failed(UserFacingError) }
    @State private var selection: Int?
    @State private var phase = Phase.choosing
    @State private var place: NearbyPlace?
    @State private var media: VenueMedia?
    @State private var measuring = false
    @State private var photo: UIImage?
    @State private var reportText = ""
    @State private var noiseDb: Int?
    @State private var success: Contribution?

    private var locked: Bool {
        switch phase { case .sending, .done, .expired: true; default: false }
    }
    private var isNoiseRequest: Bool { request.sensor == "noise" }
    private var isPhotoRequest: Bool { request.sensor == "photo" || request.sensor == "people_count" }
    private var isReport: Bool { request.sensor == "report" }
    private var reply: String { reportText.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// A tap answer always works; a reading, photo or written reply can stand in for it on matching requests.
    private var canSubmit: Bool {
        selection != nil || (isNoiseRequest && noiseDb != nil) || (isPhotoRequest && photo != nil) || (isReport && !reply.isEmpty)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let place { VenueImage(place: place, media: media, loading: media == nil && session.isConnected) }
                    TagCard(tag: request.isPoll ? "Live poll · \(request.place)" : "Live request · \(request.place)", color: Ink.mint) {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(request.question).font(.display(.title2)).foregroundStyle(Ink.charcoal).fixedSize(horizontal: false, vertical: true)
                            if request.likelyExpired, phase == .choosing {
                                Text("This request may have closed already. You can still try.").font(.soft(.caption)).foregroundStyle(Ink.muted)
                            }
                            ForEach(Array(request.options.enumerated()), id: \.offset) { index, option in
                                let chosen = selection == index + 1
                                Button { selection = index + 1 } label: {
                                    HStack {
                                        Text(option).font(.bold(.headline))
                                        Spacer()
                                        Image(systemName: chosen ? "checkmark.circle.fill" : "circle").font(.title3.weight(.bold))
                                    }
                                    .foregroundStyle(Ink.charcoal)
                                    .padding(.horizontal, 16).frame(minHeight: 54)
                                    .inkOutline(16, fill: chosen ? Ink.mint : Ink.paper, line: chosen ? 3 : 2)
                                }
                                .buttonStyle(SquishStyle())
                                .disabled(locked)
                                .accessibilityAddTraits(chosen ? .isSelected : [])
                            }
                        }
                    }
                    status
                    if isReport { reportCard }
                    PhotoCaptureCard(sensor: request.sensor, photo: $photo, disabled: locked)
                    noiseCard
                }
                .padding(20)
                .frame(maxWidth: 600).frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .bottom) {
                // Once finished, the status card's own button takes over so nothing is covered.
                switch phase { case .done, .expired: EmptyView(); default: submitBar }
            }
            .background(DotBackground())
            .navigationTitle(request.place)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.font(.bold(.body)) } }
            .fullScreenCover(isPresented: $measuring) {
                MeasureNoiseScreen(placeName: request.place) { db in noiseDb = db }
            }
            .fullScreenCover(item: $success) { contribution in
                ContributionSuccessView(contribution: contribution,
                                        onImpact: { router.sheet = nil; router.select(.rewards) },
                                        onDone: { success = nil; dismiss() })
            }
        }
        .interactiveDismissDisabled(phase == .sending)
        .task { await loadVenue() }
    }

    /// Optional on every poll, the main answer on noise requests. Only the dB number is sent.
    private var noiseCard: some View {
        TagCard(tag: isNoiseRequest ? "Noise reading · earns a bonus" : "Add a noise reading · optional", color: Ink.butter) {
            HStack(spacing: 12) {
                Image(systemName: "waveform").font(.title2.weight(.bold)).foregroundStyle(Ink.charcoal)
                    .frame(width: 46, height: 46).inkOutline(14, fill: Ink.butterSoft)
                VStack(alignment: .leading, spacing: 2) {
                    if let noiseDb {
                        Text("\(noiseDb) dB · \(NoiseLevel(db: Double(noiseDb)).title)").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                        Text("Sent with your answer.").font(.soft(.caption)).foregroundStyle(Ink.muted)
                    } else {
                        Text("Measure noise").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                        Text("10 seconds with your mic. Audio never leaves your phone.").font(.soft(.caption)).foregroundStyle(Ink.muted)
                    }
                }
                Spacer(minLength: 0)
                Button(noiseDb == nil ? "Start" : "Redo") { measuring = true }
                    .buttonStyle(.chunky(Ink.butter, height: 40)).fixedSize()
                    .disabled(locked)
            }
        }
    }

    @ViewBuilder private var status: some View {
        switch phase {
        case .done(let message): NoticeCard(kind: .success, title: "Answer sent", message: message, actionTitle: "Done") { dismiss() }
        case .expired(let message): NoticeCard(kind: .info, title: "This request has closed", message: message, actionTitle: "Back to requests") { dismiss() }
        case .failed(let error): NoticeCard(kind: .error, title: error.title, message: error.message + (error.kind == .offline ? " Your answer wasn’t sent." : ""))
        default: EmptyView()
        }
    }

    /// "Find out" requests: a short written reply (the tap answer is optional).
    private var reportCard: some View {
        TagCard(tag: "Your reply", color: Ink.periwinkle) {
            VStack(alignment: .leading, spacing: 8) {
                TextField("What did you find out?", text: $reportText, axis: .vertical)
                    .lineLimit(2...5)
                    .font(.soft(.body)).foregroundStyle(Ink.charcoal)
                    .padding(12).inkOutline(14, fill: Ink.paper)
                    .disabled(locked)
                Text("A sentence is plenty, e.g. “Yes, they’re open until 9 tonight.”").font(.soft(.caption)).foregroundStyle(Ink.muted)
            }
        }
    }

    private var submitBar: some View {
        Button { submit() } label: {
            HStack(spacing: 8) {
                if phase == .sending { ProgressView().tint(.white) }
                Text(submitTitle).frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.chunky(Ink.blue, text: .white))
        .disabled(!canSubmit || locked)
        .padding(.horizontal, 20).padding(.vertical, 8)
        .background(Ink.cream.opacity(0.95))
    }

    private var submitTitle: String {
        switch phase {
        case .sending: "Sending…"
        case .done: "Answer sent"
        case .expired: "Request closed"
        case .failed: "Retry"
        case .choosing: canSubmit ? "Submit answer" : (isNoiseRequest ? "Pick an answer or measure" : isPhotoRequest ? "Pick an answer or take a photo" : "Pick an answer")
        }
    }

    private func submit() {
        guard canSubmit, !locked else { return }
        phase = .sending
        var body: [String: Any] = [:]
        if let selection { body["option"] = selection }
        if let noiseDb { body["db"] = noiseDb }
        if isReport, !reply.isEmpty { body["text"] = String(reply.prefix(500)) }
        if let photo, let image = PhotoUpload.dataURL(for: photo) { body["image"] = image; body["mime"] = "image/jpeg" }
        let sentPhoto = photo != nil
        Task {
            do {
                let result: ServerMessage = try await session.request("api/app/answer/\(request.id)", body: body)
                let message = result.message ?? ""
                if result.ok == true {
                    let points = result.points ?? 1
                    phase = .done(message.isEmpty ? "+\(points) points." : message)
                    let answer = selection.flatMap { request.options.indices.contains($0 - 1) ? request.options[$0 - 1] : nil }
                    let kind = sentPhoto ? "Answer + photo" : noiseDb != nil ? "Answer + noise reading" : "Answer"
                    EarningsLog.add(.init(title: "\(kind) · \(request.place)", points: points, at: .now))
                    var contribution = Contribution(place: request.place, answer: answer, noiseDb: noiseDb ?? (isNoiseRequest ? result.value.map { Int($0) } : nil), points: points)
                    contribution.photo = PhotoUpload.image(fromDataURL: result.image)
                    contribution.detail = message.isEmpty ? nil : message
                    if request.sensor == "people_count", let count = result.value { contribution.headcount = Int(count) }
                    success = contribution
                } else if result.code == "already_answered" || message.localizedCaseInsensitiveContains("already answered this one") {
                    // A retry after a dropped connection: the first submission was recorded.
                    phase = .done("Your answer was already recorded.")
                } else if ["closed", "not_for_you"].contains(result.code) || message.localizedCaseInsensitiveContains("already answered") || message.localizedCaseInsensitiveContains("expired") {
                    phase = .expired(message.isEmpty ? "This request closed before your answer arrived." : message)
                } else {
                    phase = .failed(.init(kind: .server, title: "Not accepted", message: message.isEmpty ? "Oracle didn’t accept that answer." : message))
                }
                try? await session.refreshAccount()
            } catch {
                phase = .failed(UserFacingError.from(error, context: "submit answer"))
            }
        }
    }

    private func loadVenue() async {
        guard session.hasServer else { return }
        struct Located: Decodable { let id: String; let name: String; let lat: Double; let lng: Double; var kind: String? }
        guard let located: Located = try? await session.request("api/app/place/\(request.placeId)") else { return }
        let venue = NearbyPlace(id: located.id, name: located.name, lat: located.lat, lng: located.lng, kind: located.kind)
        place = venue
        media = try? await session.request("api/app/venue-media", body: ["placeId": venue.id, "name": venue.name, "lat": venue.lat, "lng": venue.lng])
        if media == nil { media = VenueMedia(url: nil, attribution: nil, source: nil) }
    }
}

// MARK: - Rewards

struct RewardsScreen: View {
    @Environment(OracleSession.self) private var session
    @Environment(Router.self) private var router
    @State private var wallet = ""
    @State private var confirming: OracleReward?
    @State private var busy = false
    @State private var notice: (kind: NoticeCard.Kind, title: String, message: String)?
    @State private var earnings: [EarningEntry] = []
    @State private var streak = 0
    @State private var jumpToGiftCards = 0

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Rewards").font(.display(.largeTitle)).foregroundStyle(Ink.charcoal)
                if session.isConnected { connected } else {
                    VStack(alignment: .leading, spacing: 14) {
                        OraHero(title: "points live here", message: "Sign in to an Oracle account to see your points and gift cards.", oraSize: 90)
                        Button { router.present(.account) } label: { Label("Sign in", systemImage: "person.crop.circle.fill").frame(maxWidth: .infinity) }
                            .buttonStyle(.chunky(Ink.blue, text: .white))
                        Text("Sample points from “Try a sample” are kept separately and never appear here.").font(.soft(.caption)).foregroundStyle(Ink.muted)
                    }
                }
            }
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
            .frame(maxWidth: 600).frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(DotBackground())
        .toolbar(.hidden, for: .navigationBar)
        .onChange(of: jumpToGiftCards) { _, _ in withAnimation { proxy.scrollTo("giftCards", anchor: .top) } }
        }
        .task(id: router.tab == .rewards) {
            guard router.tab == .rewards else { return }
            earnings = EarningsLog.today
            streak = EarningsLog.streakDays
            if session.isConnected { try? await session.refreshAccount() }
        }
    }

    @ViewBuilder private var connected: some View {
        let account = session.account
        VStack(alignment: .leading, spacing: 4) {
            Text("\(account?.credits ?? 0)").font(.system(size: 60, weight: .black, design: .rounded)).foregroundStyle(Ink.charcoal)
            Text("Oracle points").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
            HStack(spacing: 8) {
                if let trust = account?.trust { Chip(text: "Trust \(trust.formatted(.number.precision(.fractionLength(1))))", symbol: "star.fill", fill: Ink.paper) }
                if let answered = account?.answered { Chip(text: "\(answered) answered", symbol: "bubble.left.fill", fill: Ink.paper) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .inkCard(fill: Ink.butter)
        PointsEarnedCard(entries: earnings, streak: streak) { jumpToGiftCards += 1 }
        if let notice { NoticeCard(kind: notice.kind, title: notice.title, message: notice.message) }
        SectionTitle(text: "Gift cards").id("giftCards")
        ForEach(account?.rewards ?? []) { reward in
            let affordable = (account?.credits ?? 0) >= reward.points
            TagCard(tag: "\(reward.points) points", color: affordable ? Ink.pink : Ink.pinkSoft) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(reward.name).font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                    if confirming?.id == reward.id {
                        Text("Spend \(reward.points) points? Gift cards are sent by the Oracle team.").font(.soft(.subheadline)).foregroundStyle(Ink.muted)
                        HStack(spacing: 10) {
                            Button("Cancel") { confirming = nil }.buttonStyle(.chunky(Ink.paper, height: 42))
                            Button("Redeem") { redeem(reward) }.buttonStyle(.chunky(Ink.pink, height: 42)).disabled(busy)
                        }
                    } else {
                        Button(affordable ? "Redeem" : "Need \(reward.points - (account?.credits ?? 0)) more") { confirming = reward }
                            .buttonStyle(.chunky(Ink.paper, height: 42)).disabled(!affordable || busy)
                    }
                }
            }
        }
        SectionTitle(text: "Solana devnet wallet")
        VStack(alignment: .leading, spacing: 10) {
            Text(account?.linkedWallet == true ? "Linked wallet: \(short(account?.wallet))" : "Payouts go to an Oracle-managed devnet wallet unless you link your own.")
                .font(.soft(.subheadline)).foregroundStyle(Ink.charcoal)
            InkField(title: "Solana wallet address", text: $wallet, symbol: "wallet.pass")
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Link wallet") { link() }.buttonStyle(.chunky(Ink.periwinkle, height: 44)).disabled(wallet.isEmpty || busy)
            Text("Devnet only: these tokens have no real-world value.").font(.soft(.caption)).foregroundStyle(Ink.muted)
        }
        .inkCard()
    }

    private func short(_ s: String?) -> String { guard let s, s.count > 10 else { return s ?? "" }; return "\(s.prefix(4))…\(s.suffix(4))" }

    private func redeem(_ reward: OracleReward) { perform("api/app/redeem", ["rewardId": reward.id]) { confirming = nil } }
    private func link() { perform("api/app/wallet", ["address": wallet.trimmingCharacters(in: .whitespaces)]) { wallet = "" } }

    private func perform(_ path: String, _ body: [String: Any], onSuccess: @escaping () -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let result: ServerMessage = try await session.request(path, body: body)
                if result.ok == true { onSuccess(); notice = (.success, "Done", result.message ?? "Saved.") }
                else { notice = (.error, "Not completed", result.message ?? "Please try again.") }
                try? await session.refreshAccount()
            } catch {
                let e = UserFacingError.from(error, context: path)
                notice = (.error, e.title, e.message)
            }
        }
    }
}
