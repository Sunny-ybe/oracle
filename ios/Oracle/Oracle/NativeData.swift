import SwiftUI
import MapKit
import CoreLocation
import Security
import Network
import os

enum Log {
    static let search = Logger(subsystem: "com.oracleprototype.Oracle", category: "search")
    static let api = Logger(subsystem: "com.oracleprototype.Oracle", category: "api")
    static let location = Logger(subsystem: "com.oracleprototype.Oracle", category: "location")
}

// MARK: - Models

struct NearbyPlace: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let lat: Double
    let lng: Double
    var kind: String?
    var tagline: String?
    var headline: PlaceHeadline?
    var people_here: Int?
    var distanceM: Double?
    var address: String?
    var phone: String?
    var website: String?
    var isSample: Bool?

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
    var isOracleKnown: Bool { !id.hasPrefix("map-") && isSample != true }
    var subtitle: String { [address ?? tagline, distanceText].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ") }
    var distanceText: String? {
        guard let distanceM else { return nil }
        let measurement = Measurement(value: distanceM, unit: UnitLength.meters)
        return measurement.formatted(.measurement(width: .abbreviated, usage: .road, numberFormatStyle: .number.precision(.fractionLength(0...1))))
    }
    var symbol: String {
        switch kind {
        case "coffee": "cup.and.saucer.fill"
        case "food": "fork.knife"
        case "library": "books.vertical.fill"
        case "gym": "dumbbell.fill"
        case "park": "leaf.fill"
        case "store": "bag.fill"
        case "events": "ticket.fill"
        case "campus": "graduationcap.fill"
        case "transit": "tram.fill"
        case "museum": "building.columns.fill"
        default: "mappin"
        }
    }
    var tint: Color {
        switch kind {
        case "coffee", "food": Ink.butter
        case "library", "campus", "museum": Ink.periwinkle
        case "park", "gym": Ink.mint
        default: Ink.pink
        }
    }
    /// Opens this venue in Apple Maps, pinned at its coordinates with its name.
    func openInAppleMaps() {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        item.name = name
        item.openInMaps(launchOptions: [MKLaunchOptionsMapCenterKey: NSValue(mkCoordinate: coordinate)])
    }
    static func == (a: NearbyPlace, b: NearbyPlace) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct PlaceHeadline: Codable, Hashable {
    var question: String?
    var answer: String?
    var source: String?
    var at: String?
    var votes: Int?
}

struct PlaceReport: Decodable {
    struct Item: Decodable, Hashable { var question: String?; var answer: String?; var source: String?; var votes: Int?; var at: String? }
    var id: String
    var name: String?
    var headline: PlaceHeadline?
    var people_here: Int?
    var photo: String?
    var photoAt: String?
    var history: [Item]?
}

struct OracleRequest: Codable, Identifiable, Hashable {
    let id: String
    let place: String
    let placeId: String
    let question: String
    let options: [String]
    let sensor: String?
    var at: String?
    var answered: Int?
    var pinged: Int?
    var isPoll: Bool { sensor == nil || sensor == "poll" }
    var askedDate: Date? { at.flatMap(ISO8601.parse) }
    /// The server settles unanswered questions after about 90 seconds.
    var likelyExpired: Bool { askedDate.map { Date().timeIntervalSince($0) > 95 } ?? false }
    var sensorLabel: String? {
        switch sensor {
        case "noise": "Noise reading"
        case "photo": "Photo"
        case "people_count": "Headcount photo"
        case "report": "Find out"
        default: nil
        }
    }
}

struct OracleReward: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let points: Int
}

struct OracleAccount: Decodable {
    let name: String
    var username: String?
    var credits: Int?
    var trust: Double?
    var requests: [OracleRequest]
    var rewards: [OracleReward]?
    var wallet: String?
    var linkedWallet: Bool?
    var place: String?
    var answered: Int?
    var correct: Int?
    var earnedSol: Double?
}

struct ServerMessage: Decodable {
    let ok: Bool?
    let message: String?
    let points: Int?
    /// Photo answers: the privacy-masked photo (data URL) and the measured value (headcount or dB).
    var image: String?
    var value: Double?
    /// already_answered, closed or not_for_you on answer failures.
    var code: String?
}

struct VenueMedia: Decodable {
    struct Author: Decodable, Hashable { let name: String?; let uri: String? }
    let url: String?
    let attribution: String?
    let source: String?
    var googlePlaceId: String?
    var capturedAt: String?
    var authors: [Author]?
    /// Wikimedia Commons photos: credit line and the file's page.
    var author: String?
    var license: String?
    var pageUrl: String?
}

struct ServerConfig: Decodable {
    struct Integrations: Decodable { var gemini: Bool?; var venuePhotos: Bool?; var telegram: Bool?; var discord: Bool?; var solanaDevnet: Bool?; var tinyfish: Bool? }
    struct MCP: Decodable { var url: String?; var path: String?; var transport: String?; var auth: String?; var oauth: Bool? }
    let name: String
    var integrations: Integrations?
    var mcp: MCP?
}

enum ISO8601 {
    static func parse(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
    static func relative(_ s: String?) -> String? {
        guard let s, let d = parse(s) else { return nil }
        return d.formatted(.relative(presentation: .named))
    }
}

// MARK: - Errors (scoped to the screen that produced them)

struct UserFacingError: Error, Equatable, Identifiable {
    enum Kind { case offline, unauthorized, throttled, server, notFound, location, other }
    var id = UUID()
    var kind: Kind
    var title: String
    var message: String

    static func == (a: Self, b: Self) -> Bool { a.id == b.id }

    /// Converts a raw error into a sentence a person can act on. Details go to the development log only.
    static func from(_ error: Error, context: String) -> UserFacingError {
        if let e = error as? UserFacingError { return e }
        let ns = error as NSError
        Log.api.error("\(context, privacy: .public) failed: \(ns.domain, privacy: .public) \(ns.code) \(String(describing: ns.userInfo), privacy: .private)")
        if let api = error as? APIError {
            switch api {
            case .unauthorized: return .init(kind: .unauthorized, title: "Sign in again", message: "Your Oracle session has ended.")
            case .server(let message): return .init(kind: .server, title: "Oracle couldn’t do that", message: message)
            case .notConfigured: return .init(kind: .other, title: "Connect an Oracle server", message: "Add your Oracle server address in Settings → Oracle account.")
            case .badResponse: return .init(kind: .server, title: "Unexpected response", message: "The Oracle server sent something this app didn’t understand. Check the server address.")
            }
        }
        if isOffline(ns) { return .init(kind: .offline, title: "You’re offline", message: "Check your connection, then try again.") }
        if ns.domain == NSURLErrorDomain, ns.code == NSURLErrorTimedOut {
            return .init(kind: .server, title: "That took too long", message: "The server didn’t answer in time. Try again.")
        }
        if ns.domain == NSURLErrorDomain, [NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorSecureConnectionFailed].contains(ns.code) {
            return .init(kind: .server, title: "Can’t reach the Oracle server", message: "Check the server address in Settings, or try again later.")
        }
        if ns.domain == MKError.errorDomain {
            switch MKError.Code(rawValue: UInt(ns.code)) {
            case .loadingThrottled: return .init(kind: .throttled, title: "Too many searches", message: "Apple Maps is limiting searches for a moment. Wait a few seconds and retry.")
            case .placemarkNotFound: return .init(kind: .notFound, title: "No places found", message: "Try a different name, or add a city.")
            case .serverFailure: return .init(kind: .server, title: "Map search is unavailable", message: "Apple Maps couldn’t complete the search. Try again shortly.")
            default: break
            }
        }
        if ns.domain == kCLErrorDomain {
            return .init(kind: .location, title: "Location unavailable", message: ns.code == CLError.denied.rawValue
                         ? "Location access is off. Search for a city or venue instead."
                         : "Your location couldn’t be found right now. Search for a city or venue instead.")
        }
        return .init(kind: .other, title: "Something went wrong", message: "Please try again.")
    }

    static func isOffline(_ ns: NSError) -> Bool {
        let offline = [NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff]
        if ns.domain == NSURLErrorDomain, offline.contains(ns.code) { return true }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError { return isOffline(underlying) }
        return false
    }
}

enum APIError: Error { case notConfigured, unauthorized, server(String), badResponse }

// MARK: - Keychain

private enum SessionKey {
    static func read() -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "oracle.session", kSecReturnData as String: true]
        var value: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    static func save(_ token: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "oracle.session"]
        SecItemDelete(query as CFDictionary)
        guard !token.isEmpty else { return }
        var item = query
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
}

// MARK: - Oracle session (backend account, separate from the Apple device profile)

@MainActor @Observable final class OracleSession {
    enum State: Equatable {
        case signedOut
        case checking
        case connected
        case expired
        case unreachable(String)
    }

    private(set) var baseURL: String = UserDefaults.standard.string(forKey: "oracle.server") ?? ProcessInfo.processInfo.environment["ORACLE_API_BASE_URL"] ?? OracleSession.defaultServer

    /// ⚠️ Before a TestFlight build: set this to your deployed server (Vultr + your domain), e.g. "https://oracle.example.com".
    /// Testers' iPhones then connect automatically. Empty means testers must type the address in Settings.
    static let productionServer = ""

    /// The Simulator shares the Mac's network, so a server started with `npm run dev` is at localhost.
    /// A real iPhone can't reach localhost, so it uses `productionServer`.
    static var defaultServer: String {
        #if targetEnvironment(simulator)
        "http://localhost:3000"
        #else
        productionServer
        #endif
    }
    private(set) var state: State = .signedOut
    private(set) var account: OracleAccount?
    private(set) var server: ServerConfig?
    private var token = SessionKey.read()

    var isConnected: Bool { state == .connected && account != nil }
    var hasServer: Bool { !baseURL.isEmpty }
    var hasStoredSession: Bool { !token.isEmpty }

    init() {
        // Keychain items survive app deletion. A fresh install starts signed out instead of reusing an old session.
        if !UserDefaults.standard.bool(forKey: "oracle.installed") {
            SessionKey.save("")
            token = ""
            UserDefaults.standard.set(true, forKey: "oracle.installed")
        }
        if !token.isEmpty { state = .checking }
    }

    /// Validates the address and confirms it is an Oracle server before saving it.
    func connectServer(_ raw: String) async throws {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: text), let host = url.host, url.user == nil, url.password == nil, url.query == nil else {
            throw UserFacingError(kind: .other, title: "Check the address", message: "Enter the server’s full address, like https://oracle.example.com.")
        }
        let local = ["localhost", "127.0.0.1"].contains(host) || host.hasSuffix(".local")
        guard url.scheme == "https" || (url.scheme == "http" && local) else {
            throw UserFacingError(kind: .other, title: "Use HTTPS", message: "Oracle servers must use https:// (http is only allowed for localhost while developing).")
        }
        let config: ServerConfig = try await send(base: text, path: "api/app/config", body: nil, token: "")
        guard config.name == "Oracle" else { throw APIError.badResponse }
        if baseURL != text { signOut() }
        baseURL = text
        server = config
        UserDefaults.standard.set(text, forKey: "oracle.server")
    }

    func signIn(username: String, password: String, first: String, last: String, register: Bool) async throws {
        struct Auth: Decodable { let token: String }
        let auth: Auth = try await send(base: baseURL, path: register ? "api/app/register" : "api/app/login",
                                        body: ["username": username, "password": password, "firstName": first, "lastName": last], token: "")
        // Only report "connected" after the server accepts the new token.
        let me: OracleAccount = try await send(base: baseURL, path: "api/app/me", body: nil, token: auth.token)
        token = auth.token
        SessionKey.save(token)
        account = me
        state = .connected
    }

    /// Google / Microsoft: the Oracle server verifies the provider's token and returns an Oracle session.
    func signIn(provider: OAuthProvider, credential: String, firstName: String? = nil, lastName: String? = nil) async throws {
        struct Auth: Decodable { let token: String }
        let body: [String: Any] = switch provider {
        case .google: ["credential": credential]
        case .microsoft: ["accessToken": credential]
        case .apple: ["identityToken": credential, "firstName": firstName ?? "", "lastName": lastName ?? ""]
        }
        let auth: Auth = try await send(base: baseURL, path: "api/app/oauth/\(provider.rawValue)", body: body, token: "")
        let me: OracleAccount = try await send(base: baseURL, path: "api/app/me", body: nil, token: auth.token)
        token = auth.token
        SessionKey.save(token)
        account = me
        state = .connected
    }

    /// Permanently deletes the Oracle account on the server, then signs out.
    func deleteAccount() async throws {
        struct Done: Decodable { let ok: Bool? }
        let _: Done = try await request("api/app/account/delete", body: [:])
        signOut()
    }

    func signOut() {
        token = ""
        SessionKey.save("")
        account = nil
        state = .signedOut
    }

    /// Re-validates a stored session at launch or when returning to the app.
    func restore() async {
        if hasServer, server == nil { server = try? await send(base: baseURL, path: "api/app/config", body: nil, token: "") }
        guard !token.isEmpty, hasServer else { if token.isEmpty { state = .signedOut }; return }
        if state != .connected { state = .checking }
        do {
            try await refreshAccount()
        } catch {
            if state == .expired { return }
            state = .unreachable(UserFacingError.from(error, context: "restore session").message)
        }
    }

    func refreshAccount() async throws {
        let me: OracleAccount = try await request("api/app/me")
        account = me
        state = .connected
        await Notifier.shared.announce(me.requests)
    }

    func request<T: Decodable>(_ path: String, body: [String: Any]? = nil) async throws -> T {
        guard hasServer else { throw APIError.notConfigured }
        do {
            return try await send(base: baseURL, path: path, body: body, token: token)
        } catch APIError.unauthorized {
            if !token.isEmpty { token = ""; SessionKey.save(""); account = nil; state = .expired }
            throw APIError.unauthorized
        }
    }

    /// Web capture handoff for photo and sensor requests. The web app reads `t` once and stores it locally.
    func captureURL(for request: OracleRequest) -> URL? {
        guard var c = URLComponents(string: baseURL) else { return nil }
        c.path = "/app"
        c.queryItems = [.init(name: "q", value: request.id), .init(name: "t", value: token)]
        return c.url
    }

    func absoluteURL(_ raw: String) -> URL? {
        if raw.hasPrefix("http") { return URL(string: raw) }
        return URL(string: raw, relativeTo: URL(string: baseURL))?.absoluteURL
    }

    private struct Failure: Decodable { let error: String? }

    private func send<T: Decodable>(base: String, path: String, body: [String: Any]?, token: String) async throws -> T {
        guard let baseURL = URL(string: base), baseURL.host != nil else { throw APIError.notConfigured }
        let parts = path.split(separator: "?", maxSplits: 1).map(String.init)
        guard var components = URLComponents(url: baseURL.appending(path: parts[0]), resolvingAgainstBaseURL: false) else { throw APIError.notConfigured }
        if parts.count == 2 { components.percentEncodedQuery = parts[1] }
        guard let url = components.url else { throw APIError.notConfigured }
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        if !token.isEmpty { request.setValue(token, forHTTPHeaderField: "x-oracle-token") }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            let failure = try? JSONDecoder().decode(Failure.self, from: data)
            Log.api.error("\(path, privacy: .public) HTTP \(http.statusCode)")
            throw APIError.server(failure?.error ?? "The server couldn’t complete that request (HTTP \(http.statusCode)).")
        }
        do { return try JSONDecoder().decode(T.self, from: data) } catch {
            Log.api.error("\(path, privacy: .public) decode failed: \(String(describing: error), privacy: .public)")
            throw APIError.badResponse
        }
    }
}

// MARK: - Location

@MainActor @Observable final class LocationService: NSObject, @preconcurrency CLLocationManagerDelegate {
    enum LocationError: Error { case denied, unavailable }
    private(set) var status: CLAuthorizationStatus
    private(set) var last: CLLocation?
    private let manager = CLLocationManager()
    private var waiting: [CheckedContinuation<CLLocation, Error>] = []

    override init() {
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    var denied: Bool { status == .denied || status == .restricted }
    var authorized: Bool { status == .authorizedWhenInUse || status == .authorizedAlways }

    /// One location fix for Near me. (Continuous sharing is LiveLocation, which is opt-in.)
    func current() async throws -> CLLocation {
        if denied { throw LocationError.denied }
        return try await withCheckedThrowingContinuation { continuation in
            waiting.append(continuation)
            if status == .notDetermined { manager.requestWhenInUseAuthorization() } else { manager.requestLocation() }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        status = manager.authorizationStatus
        Log.location.info("authorization \(self.status.rawValue)")
        if authorized, !waiting.isEmpty { manager.requestLocation() }
        if denied { finish(.failure(LocationError.denied)) }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        last = latest
        finish(.success(latest))
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let ns = error as NSError
        Log.location.error("location failed: \(ns.domain, privacy: .public) \(ns.code)")
        if ns.domain == kCLErrorDomain, ns.code == CLError.locationUnknown.rawValue, waiting.isEmpty { return }
        finish(.failure(ns.code == CLError.denied.rawValue ? LocationError.denied : LocationError.unavailable))
    }
    private func finish(_ result: Result<CLLocation, Error>) {
        let pending = waiting
        waiting = []
        pending.forEach { $0.resume(with: result) }
    }
}

// MARK: - Connectivity

@MainActor @Observable final class Connectivity {
    private(set) var online = true
    private let monitor = NWPathMonitor()
    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in self?.online = path.status == .satisfied }
        }
        monitor.start(queue: DispatchQueue(label: "oracle.network"))
    }
}

// MARK: - Place search (MapKit + Oracle places)

struct SearchArea: Codable, Equatable {
    var title: String
    var lat: Double
    var lng: Double
    var nearMe: Bool
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

@MainActor @Observable final class PlaceSearch {
    enum Phase: Equatable { case idle, loading, loaded, empty(String), failed(UserFacingError) }
    private enum Operation { case nearby(CLLocationCoordinate2D, String), text(String) }

    private(set) var area: SearchArea? {
        didSet { if let area, let data = try? JSONEncoder().encode(area) { UserDefaults.standard.set(data, forKey: "oracle.area") } }
    }
    private(set) var places: [NearbyPlace] = []
    private(set) var phase: Phase = .idle
    var selectedID: String?
    var selected: NearbyPlace? { places.first { $0.id == selectedID } }

    private var task: Task<Void, Never>?
    private var generation = 0
    private var lastOperation: Operation?
    private weak var session: OracleSession?
    private var location: CLLocation?

    init(session: OracleSession) {
        self.session = session
        if let data = UserDefaults.standard.data(forKey: "oracle.area"), let saved = try? JSONDecoder().decode(SearchArea.self, from: data) { area = saved }
    }

    var hasArea: Bool { area != nil }

    func reloadSavedArea() {
        guard let area, places.isEmpty, phase != .loading else { return }
        run(.nearby(area.coordinate, area.title))
    }

    func searchNearby(_ location: CLLocation) {
        self.location = location
        run(.nearby(location.coordinate, "Near you"))
    }

    func search(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        run(.text(clean))
    }

    func retry() { if let lastOperation { run(lastOperation) } else { reloadSavedArea() } }

    func select(_ place: NearbyPlace) { selectedID = place.id }

    private func run(_ op: Operation) {
        task?.cancel()
        generation += 1
        let current = generation
        lastOperation = op
        phase = .loading
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let (newArea, results) = try await self.perform(op)
                guard current == self.generation, !Task.isCancelled else { return }
                // SwiftUI lists need one view per id: drop exact repeats (same id) so no row renders blank.
                var seen = Set<String>()
                let found = results.filter { seen.insert($0.id).inserted }
                self.area = newArea
                self.places = found
                self.selectedID = found.first?.id
                self.phase = found.isEmpty ? .empty(self.emptyMessage(op)) : .loaded
            } catch is CancellationError {
                return
            } catch {
                guard current == self.generation else { return }
                let friendly = UserFacingError.from(error, context: "place search")
                if friendly.kind == .notFound {
                    self.places = []
                    self.phase = .empty(self.emptyMessage(op))
                } else {
                    self.phase = .failed(friendly)
                }
            }
        }
    }

    private func emptyMessage(_ op: Operation) -> String {
        switch op {
        case .nearby: "No places found around here. Search for a city or venue instead."
        case .text(let q): "No places matched “\(q)”. Try adding a city, like “coffee in Austin”."
        }
    }

    private func perform(_ op: Operation) async throws -> (SearchArea, [NearbyPlace]) {
        switch op {
        case .nearby(let center, let title):
            let found = try await pointsOfInterest(around: center, radius: 1500)
            let area = SearchArea(title: title, lat: center.latitude, lng: center.longitude, nearMe: title == "Near you")
            return (area, await mergeOracle(found, around: center))
        case .text(let text):
            var query = text
            if let session, session.isConnected {
                // Gemini interpretation on the server; MapKit still resolves real coordinates.
                struct Intent: Decodable { let query: String }
                if let intent: Intent = try? await session.request("api/app/discover", body: ["query": text]) { query = intent.query }
                Log.search.info("interpreted query length \(query.count)")
            }
            try Task.checkCancellation()
            let request = MKLocalSearch.Request()
            request.naturalLanguageQuery = query
            request.resultTypes = [.pointOfInterest, .address]
            if let near = location?.coordinate ?? area?.coordinate {
                request.region = MKCoordinateRegion(center: near, latitudinalMeters: 60_000, longitudinalMeters: 60_000)
            }
            let response = try await start(MKLocalSearch(request: request))
            try Task.checkCancellation()
            let items = response.mapItems
            // A city or neighbourhood: show what's in it rather than a single pin.
            if let first = items.first, first.pointOfInterestCategory == nil, items.count <= 3 {
                let center = first.placemark.coordinate
                let title = first.placemark.locality ?? first.name ?? text
                let found = try await pointsOfInterest(around: center, radius: 3000)
                return (SearchArea(title: title, lat: center.latitude, lng: center.longitude, nearMe: false), await mergeOracle(found, around: center))
            }
            let found = items.prefix(25).map(place(from:))
            let center = found.first?.coordinate ?? response.boundingRegion.center
            return (SearchArea(title: text, lat: center.latitude, lng: center.longitude, nearMe: false), await mergeOracle(found, around: center))
        }
    }

    /// MKLocalSearch with a natural-language list like "cafes, libraries and parks" returns MKError 4
    /// (placemarkNotFound) everywhere, so nearby discovery uses a points-of-interest request instead.
    private func pointsOfInterest(around center: CLLocationCoordinate2D, radius: CLLocationDistance) async throws -> [NearbyPlace] {
        let request = MKLocalPointsOfInterestRequest(center: center, radius: radius)
        request.pointOfInterestFilter = MKPointOfInterestFilter(including: [
            .cafe, .restaurant, .bakery, .library, .park, .museum, .university, .fitnessCenter, .store, .theater, .publicTransport, .nationalPark, .beach,
        ])
        do {
            let response = try await start(MKLocalSearch(request: request))
            return response.mapItems.prefix(30).map(place(from:))
        } catch let error as NSError where error.domain == MKError.errorDomain && error.code == Int(MKError.placemarkNotFound.rawValue) {
            Log.search.info("no points of interest around center")
            return []
        }
    }

    private func start(_ search: MKLocalSearch) async throws -> MKLocalSearch.Response {
        try await withTaskCancellationHandler {
            try await search.start()
        } onCancel: {
            search.cancel()
        }
    }

    private func place(from item: MKMapItem) -> NearbyPlace {
        let mark = item.placemark
        let point = mark.coordinate
        let street = [mark.subThoroughfare, mark.thoroughfare].compactMap { $0 }.joined(separator: " ")
        let address = [street.isEmpty ? nil : street, mark.locality].compactMap { $0 }.joined(separator: ", ")
        var distance: Double?
        if let location { distance = location.distance(from: CLLocation(latitude: point.latitude, longitude: point.longitude)) }
        // Venues in one building (a food court) share a coordinate, so the name is part of the id.
        let name = item.name ?? "Unnamed place"
        return NearbyPlace(id: String(format: "map-%.5f-%.5f-", point.latitude, point.longitude) + name.lowercased(), name: name,
                           lat: point.latitude, lng: point.longitude, kind: Self.kind(item.pointOfInterestCategory),
                           tagline: nil, distanceM: distance, address: address.isEmpty ? nil : address,
                           phone: item.phoneNumber, website: item.url?.absoluteString)
    }

    /// Adds places Oracle already knows nearby (with live answers). Failures are logged, not shown: map results still work.
    private func mergeOracle(_ found: [NearbyPlace], around center: CLLocationCoordinate2D) async -> [NearbyPlace] {
        guard let session, session.hasServer else { return found }
        let path = "api/app/places/nearby?lat=\(center.latitude)&lng=\(center.longitude)&radiusM=3000"
        do {
            var known: [NearbyPlace] = try await session.request(path)
            if let location { known = known.map { var p = $0; p.distanceM = location.distance(from: CLLocation(latitude: p.lat, longitude: p.lng)); return p } }
            let extra = found.filter { item in !known.contains { abs($0.lat - item.lat) < 0.0003 && abs($0.lng - item.lng) < 0.0003 } }
            return known.prefix(10) + extra
        } catch {
            Log.search.error("oracle places merge failed: \(String(describing: error), privacy: .public)")
            return found
        }
    }

    static func kind(_ c: MKPointOfInterestCategory?) -> String {
        switch c {
        case .cafe?: "coffee"
        case .restaurant?, .bakery?, .brewery?, .winery?, .foodMarket?: "food"
        case .library?: "library"
        case .park?, .nationalPark?, .beach?, .campground?: "park"
        case .fitnessCenter?: "gym"
        case .store?: "store"
        case .theater?, .movieTheater?, .nightlife?, .stadium?: "events"
        case .university?, .school?: "campus"
        case .publicTransport?: "transit"
        case .museum?: "museum"
        default: "place"
        }
    }
}

// MARK: - Navigation

enum AppTab: String, CaseIterable, Identifiable {
    case home = "Home", explore = "Explore", requests = "Requests", rewards = "Rewards", settings = "Settings"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .home: "house.fill"
        case .explore: "map.fill"
        case .requests: "bubble.left.and.bubble.right.fill"
        case .rewards: "gift.fill"
        case .settings: "gearshape.fill"
        }
    }
    var color: Color {
        switch self {
        case .home: Ink.butter
        case .explore: Ink.periwinkle
        case .requests: Ink.mint
        case .rewards: Ink.pink
        case .settings: Ink.butter
        }
    }
}

enum AppSheet: Identifiable {
    case account, poll(OracleRequest), assistants, location, sample, game
    var id: String {
        switch self {
        case .account: "account"
        case .poll(let r): "poll-\(r.id)"
        case .assistants: "assistants"
        case .location: "location"
        case .sample: "sample"
        case .game: "game"
        }
    }
}

/// Single source of truth for tabs, per-tab navigation stacks and the one presented sheet.
@MainActor @Observable final class Router {
    var tab: AppTab = .home
    var homePath = NavigationPath()
    var explorePath = NavigationPath()
    var sheet: AppSheet?
    var fullMap = false
    var focusExploreSearch = false

    func select(_ newTab: AppTab) {
        if newTab != tab { AppSounds.shared.play(.tap) }
        if newTab == tab {
            // Tapping the current tab returns to its root.
            switch newTab { case .home: homePath = NavigationPath(); case .explore: explorePath = NavigationPath(); default: break }
        }
        tab = newTab
    }
    func present(_ s: AppSheet) {
        AppSounds.shared.play(.tap)
        fullMap = false
        sheet = s
    }
    func openPlace(_ place: NearbyPlace, in tab: AppTab) {
        AppSounds.shared.play(.tap)
        switch tab {
        case .home: homePath.append(place)
        default:
            self.tab = .explore
            explorePath.append(place)
        }
    }
}
