import SwiftUI
import UserNotifications

/// Quick-poll notifications: "Quick Poll · Student Pavilion / How crowded is it right now?"
/// with one button per answer. Answering from the notification sends it without opening the app.
///
/// Two paths, same look and buttons:
/// - Apple Push (APNs) from the Oracle server reaches the phone even when the app is closed
///   (server .env: APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID; Xcode: Push Notifications capability).
/// - Local notifications when the open app sees a new request (works with no push setup at all).
/// Both carry the request, so answer buttons send the answer without opening the app.
@MainActor final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()

    /// Sends an answer; returns false if it wasn't accepted (then the poll opens instead).
    var answer: ((OracleRequest, Int) async -> Bool)?
    /// Opens a request in the app.
    var open: ((OracleRequest) -> Void)? {
        didSet { if let pendingOpen, let open { self.pendingOpen = nil; open(pendingOpen) } }
    }
    private var pendingOpen: OracleRequest?
    private var categories: Set<UNNotificationCategory> = []
    private let announcedKey = "oracle.notified"
    private lazy var announced = Set(UserDefaults.standard.stringArray(forKey: announcedKey) ?? [])

    /// Apple Push token (hex) once iOS hands it over; sent to the server so requests arrive while the app is closed.
    private(set) var deviceToken: String?
    /// Uploads the token to the Oracle server (set by ContentView; it skips when signed out).
    var uploadToken: ((String) async -> Void)?

    /// The server's preset answer sets. Pre-registering them means notifications that arrive while the app is
    /// closed (APNs category "poll.<options>") still show answer buttons. Custom options still open the poll on tap.
    private static let presetOptions = [
        ["0-5 min", "5-15 min", "15+ min"], ["Empty", "Some space", "Packed"], ["Quiet", "Chatty", "Loud"],
        ["Calm", "Busy", "Chaotic"], ["Yes", "Partly", "No"], ["Under 15", "15-40", "40+"],
    ]

    /// Call at launch so taps on notifications that arrive while the app is closed are handled.
    func setUp() {
        UNUserNotificationCenter.current().delegate = self
        register(category(id: "ORACLE_POLL", options: ["Quiet", "Moderate", "Busy"]))
        for options in Self.presetOptions { register(category(id: "poll.\(options.joined(separator: "|"))", options: options)) }
    }

    @discardableResult
    func requestPermission() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if granted { UIApplication.shared.registerForRemoteNotifications() }
        return granted
    }

    func didRegister(deviceToken data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        deviceToken = hex
        Task { await uploadToken?(hex) }
    }

    /// Posts one notification for each request not announced before.
    func announce(_ requests: [OracleRequest]) async {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        guard status == .authorized || status == .provisional else { return }
        for request in requests where !announced.contains(request.id) && !request.likelyExpired {
            announced.insert(request.id)
            await post(request)
        }
        UserDefaults.standard.set(Array(announced.suffix(300)), forKey: announcedKey)
    }

    func post(_ request: OracleRequest) async {
        let poll = category(id: "poll.\(request.options.joined(separator: "|"))", options: request.options)
        register(poll)

        let content = UNMutableNotificationContent()
        content.title = "\(request.isPoll ? "Quick Poll" : "Quick Request") · \(request.place)"
        content.body = request.question
        content.sound = .default
        content.categoryIdentifier = poll.identifier
        content.threadIdentifier = "oracle-requests"
        content.interruptionLevel = .active
        if let data = try? JSONEncoder().encode(request) { content.userInfo = ["request": data] }
        if let ora = oraAttachment() { content.attachments = [ora] }
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: request.id, content: content, trigger: nil))
    }

    /// A short confirmation after answering from a notification.
    func confirm(_ text: String) async {
        let content = UNMutableNotificationContent()
        content.title = "Oracle"
        content.body = text
        content.threadIdentifier = "oracle-requests"
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    // MARK: Categories and attachment

    private func category(id: String, options: [String]) -> UNNotificationCategory {
        let icons = ["person.fill", "person.2.fill", "person.3.fill"]
        let actions = options.prefix(3).enumerated().map { index, title in
            UNNotificationAction(identifier: "opt\(index + 1)", title: title, options: [],
                                 icon: UNNotificationActionIcon(systemImageName: icons[index]))
        }
        return UNNotificationCategory(identifier: id, actions: actions, intentIdentifiers: [], options: [])
    }

    private func register(_ category: UNNotificationCategory) {
        guard !categories.contains(where: { $0.identifier == category.identifier }) else { return }
        categories.insert(category)
        UNUserNotificationCenter.current().setNotificationCategories(categories)
    }

    /// Ora as the notification thumbnail. The system moves attachment files, so each one is a fresh copy.
    private func oraAttachment() -> UNNotificationAttachment? {
        guard let source = Bundle.main.url(forResource: "OraArt", withExtension: "png") else { return nil }
        let copy = FileManager.default.temporaryDirectory.appending(path: "ora-\(UUID().uuidString).png")
        guard (try? FileManager.default.copyItem(at: source, to: copy)) != nil else { return nil }
        return try? UNNotificationAttachment(identifier: "ora", url: copy)
    }

    // MARK: Delegate

    /// Show the banner even while the app is open.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        // A push for a request the open app already announced locally would be a duplicate.
        let info = notification.request.content.userInfo
        guard info["aps"] != nil, let id = (info["request"] as? [String: Any])?["id"] as? String else { return [.banner, .sound, .list] }
        return await firstAnnouncement(of: id) ? [.banner, .sound, .list] : []
    }

    private func firstAnnouncement(of id: String) -> Bool {
        guard !announced.contains(id) else { return false }
        announced.insert(id)
        return true
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        var data = info["request"] as? Data
        if data == nil, let dict = info["request"] as? [String: Any] { data = try? JSONSerialization.data(withJSONObject: dict) }  // APNs payload
        guard let data else { return }
        await handle(requestData: data, action: response.actionIdentifier)
    }

    private func handle(requestData: Data, action: String) async {
        guard let request = try? JSONDecoder().decode(OracleRequest.self, from: requestData) else { return }
        if action.hasPrefix("opt"), let option = Int(action.dropFirst(3)), let answer {
            if await answer(request, option) { return }
        }
        if let open { open(request) } else { pendingOpen = request }
    }
}

/// Hooks the notification delegate up at launch.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        MainActor.assumeIsolated { Notifier.shared.setUp() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MainActor.assumeIsolated { Notifier.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Expected without a paid developer team / push capability; local notifications still work.
        print("Apple Push registration failed: \(error.localizedDescription)")
    }
}
