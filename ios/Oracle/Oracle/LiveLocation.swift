import SwiftUI
import CoreLocation

/// Live location: while Oracle is open and the switch is on, your position goes to the server
/// (POST /api/app/checkin {lat, lng, accuracy}). The server matches it to the place you're in, so requests
/// for places around you reach you without checking in by hand.
/// Same rules as the web app: fuzzy fixes (worse than 300 m) and tiny moves (under 40 m within 2 minutes) are skipped.
/// Uses "While Using the App" permission only; nothing is sent while Oracle is closed.
@MainActor @Observable final class LiveLocation: NSObject, @preconcurrency CLLocationManagerDelegate {
    static let shared = LiveLocation()
    private static let key = "oracle.liveLocation"

    private(set) var enabled = UserDefaults.standard.bool(forKey: LiveLocation.key)
    private(set) var status: CLAuthorizationStatus
    private(set) var lastSentAt: Date?
    private(set) var accuracy: Double?
    /// Sends one fix; returns the place the server matched (nil if none). Set by ContentView.
    @ObservationIgnored var upload: ((CLLocation) async throws -> String?)?

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var lastSent: CLLocation?
    @ObservationIgnored private var latest: CLLocation?
    @ObservationIgnored private var sending = false

    override init() {
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 25
        manager.pausesLocationUpdatesAutomatically = true
    }

    var denied: Bool { status == .denied || status == .restricted }
    var authorized: Bool { status == .authorizedWhenInUse || status == .authorizedAlways }

    func setEnabled(_ on: Bool) {
        enabled = on
        UserDefaults.standard.set(on, forKey: Self.key)
        if on { start() } else { manager.stopUpdatingLocation(); lastSentAt = nil }
    }

    /// Called at launch and whenever the app comes back to the foreground.
    func start() {
        guard enabled else { return }
        if status == .notDetermined { manager.requestWhenInUseAuthorization(); return }
        if authorized { manager.startUpdatingLocation() }
    }

    func pause() { manager.stopUpdatingLocation() }

    /// Sends the current position again right away (e.g. just after signing in).
    func resend() {
        lastSent = nil
        if let latest { Task { await maybeSend(latest) } } else { start() }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        status = manager.authorizationStatus
        if enabled && authorized { manager.startUpdatingLocation() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let fix = locations.last else { return }
        latest = fix
        Task { await maybeSend(fix) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    private func maybeSend(_ fix: CLLocation) async {
        guard enabled, let upload, !sending, fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= 300 else { return }
        if let lastSent, let at = lastSentAt, fix.distance(from: lastSent) < 40, Date().timeIntervalSince(at) < 120 { return }
        sending = true
        defer { sending = false }
        do {
            _ = try await upload(fix)
            lastSent = fix; lastSentAt = .now; accuracy = fix.horizontalAccuracy
        } catch {}
    }
}

/// On/off switch with status, used on Requests and in Settings.
struct LiveLocationCard: View {
    @Environment(OracleSession.self) private var session
    @Environment(\.openURL) private var openURL
    private var live = LiveLocation.shared

    var body: some View {
        TagCard(tag: "Live location", color: live.enabled && live.authorized ? Ink.mint : Ink.periwinkle) {
            VStack(alignment: .leading, spacing: 10) {
                Toggle(isOn: Binding(get: { live.enabled }, set: { live.setEnabled($0) })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Requests follow me").font(.bold(.headline)).foregroundStyle(Ink.charcoal)
                        Text(statusText).font(.soft(.caption)).foregroundStyle(Ink.muted)
                    }
                }
                .tint(Ink.blue)
                .accessibilityIdentifier("liveLocationToggle")
                if live.enabled && live.denied {
                    Button { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } } label: {
                        Label("Allow location in Settings", systemImage: "gear").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.chunky(Ink.paper, height: 42))
                }
            }
        }
    }

    private var statusText: String {
        if !live.enabled { return "Share your location while Oracle is open, so requests for places around you find you. No check-in needed." }
        if live.denied { return "Location access is off for Oracle." }
        if !session.isConnected { return "On. Sign in so Oracle can send you requests." }
        guard let at = live.lastSentAt else { return "On. Finding you…" }
        let place = session.account?.place.map { "You’re at \($0). " } ?? ""
        return "\(place)Updated \(at.formatted(.relative(presentation: .named)))\(live.accuracy.map { " · ±\(Int($0)) m" } ?? "")."
    }
}
