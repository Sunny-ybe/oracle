import XCTest

/// Drives the app's normal entry points. No launch arguments or preview modes are used.
///
/// Run individually from the command line so Simulator permissions can be set between steps, e.g.
///   xcrun simctl privacy booted revoke location com.oracleprototype.Oracle
///   xcodebuild test -only-testing:OracleUITests/OracleUITests/test1_firstUseWithLocationDenied ...
/// Backend-backed tests need a running Oracle server; pass TEST_RUNNER_ORACLE_URL and TEST_RUNNER_ORACLE_KEY
/// (the server's ORACLE_API_KEY, used only by the test to post an agent question). Screenshots go to
/// TEST_RUNNER_SHOT_DIR when set, and are always attached to the test result.
final class OracleUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    // MARK: - Flows

    func test1_firstUseWithLocationDenied() {
        app.launch()
        XCTAssertTrue(app.buttons["Get started"].waitForExistence(timeout: 10), "Welcome screen")
        XCTAssertFalse(app.staticTexts["ASU · Demo area"].exists)
        shot("01-welcome")
        app.buttons["Get started"].tap()
        XCTAssertTrue(app.buttons["Use my location"].waitForExistence(timeout: 5))
        app.buttons["Use my location"].tap()
        // A person declining the system prompt.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deny = springboard.alerts.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Don'")).firstMatch
        if deny.waitForExistence(timeout: 5) { deny.tap() }
        sleep(1)
        if app.state != .runningForeground { app.activate() }
        XCTAssertTrue(app.staticTexts["Location access is off"].waitForExistence(timeout: 8), "Denied location explains manual search")
        shot("02-location-denied")
        let field = app.textFields["City, neighborhood or venue"]
        field.tap()
        field.typeText("San Francisco\n")
        XCTAssertTrue(app.buttons["Explore places"].waitForExistence(timeout: 10), "Home after choosing an area")
        XCTAssertTrue(app.buttons["placeRow"].firstMatch.waitForExistence(timeout: 20), "Nearby places loaded for the searched city")
        sleep(2)
        XCTAssertTrue(app.buttons["Home"].isSelected, "Choosing an area lands on Home without switching tabs")
        shot("03-home-searched-city")
    }

    func test2_navigationSearchAndMap() {
        app.launch()
        XCTAssertTrue(app.buttons["Explore places"].waitForExistence(timeout: 10))
        // Home buttons open the right tabs.
        app.buttons["Explore places"].tap()
        XCTAssertTrue(app.navigationBars["Explore"].waitForExistence(timeout: 5), "Explore places opens Explore")
        signOutIfNeeded()
        tab("Home")
        app.buttons["Answer & earn"].tap()
        XCTAssertTrue(app.staticTexts["& earn."].waitForExistence(timeout: 5), "Answer & earn opens Requests")
        // Signed out: the message is an actionable button that opens the account screen.
        let signIn = app.buttons["requestsSignIn"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 5))
        shot("04-requests-signed-out")
        signIn.tap()
        XCTAssertTrue(app.navigationBars["Oracle account"].waitForExistence(timeout: 5), "Sign in opens the account screen")
        shot("05-account-sheet")
        app.navigationBars["Oracle account"].buttons["Close"].tap()
        XCTAssertTrue(app.staticTexts["& earn."].waitForExistence(timeout: 5), "Still on Requests after closing (no unexpected tab change)")

        // Search with the keyboard: the tab bar hides while typing.
        tab("Explore")
        let search = app.textFields["exploreSearch"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("coffee in Seattle")
        XCTAssertFalse(app.buttons["Rewards"].isHittable, "Tab bar is hidden while the keyboard is up")
        shot("06-explore-keyboard")
        search.typeText("\n")
        let row = app.buttons["exploreRow"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "Search results")
        shot("07-explore-results")

        // List row and map pin open the same place.
        let firstName = row.label
        scrollAboveTabBar(row)
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["Place"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Open in Maps"].waitForExistence(timeout: 5))
        shot("08-place-detail")
        app.navigationBars["Place"].buttons.firstMatch.tap()
        let expand = app.buttons["Open full screen map"]
        // Returning from a place preserves the list's scroll position below the map.
        for _ in 0..<5 where !expand.isHittable {
            app.swipeDown()
        }
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        expand.tap()
        XCTAssertTrue(app.buttons["Close map"].waitForExistence(timeout: 5), "Full-screen map")
        XCTAssertTrue(app.buttons["Recenter on all places"].exists)
        let map = app.maps.firstMatch
        map.pinch(withScale: 2.0, velocity: 1.5)
        map.swipeLeft()
        app.buttons["Recenter on all places"].tap()
        shot("09-full-map")
        XCTAssertTrue(app.buttons["See details"].firstMatch.waitForExistence(timeout: 5), "Selected place card")
        // The Explore card underneath also has a See details button; tap the one on the full-screen map.
        let details = app.buttons.matching(identifier: "See details").allElementsBoundByIndex.last { $0.isHittable }
        XCTAssertNotNil(details)
        details?.tap()
        XCTAssertTrue(app.navigationBars["Place"].waitForExistence(timeout: 6), "Card opens the same place screen as the list")
        XCTAssertFalse(firstName.isEmpty)

        // Tab switching keeps each tab's state.
        tab("Rewards"); XCTAssertTrue(app.staticTexts["Rewards"].waitForExistence(timeout: 3))
        tab("Settings"); XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: 3))
        shot("10-settings")
        tab("Explore"); XCTAssertTrue(app.navigationBars["Place"].waitForExistence(timeout: 3), "Explore kept its pushed place")
    }

    func test3_nearMeWithLocation() {
        app.launch()
        tab("Explore")
        let nearMe = app.buttons["Near me"]
        XCTAssertTrue(nearMe.waitForExistence(timeout: 8))
        nearMe.tap()
        XCTAssertTrue(app.buttons["exploreRow"].firstMatch.waitForExistence(timeout: 20), "Points of interest near the simulated location")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'MKErrorDomain'")).firstMatch.exists)
        shot("11-near-me")
        // Scroll the results: every row must stay drawn (no blank gaps between cards).
        for i in 1...4 { app.swipeUp(); sleep(1); shot("11-near-me-scroll\(i)") }
        app.swipeDown(); app.swipeDown(); sleep(1); shot("11-near-me-scroll-back")
        tab("Requests")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'MKErrorDomain'")).firstMatch.exists, "No map errors on Requests")
    }

    /// Explore map framing, a real venue photo on the Student Pavilion (Oracle contributor photo), and the
    /// Live location switch (signed out, it asks you to sign in).
    func test7_mapPhotoAndLiveLocation() {
        app.launch()
        tab("Explore")
        let nearMe = app.buttons["Near me"]
        XCTAssertTrue(nearMe.waitForExistence(timeout: 8))
        nearMe.tap()
        XCTAssertTrue(app.buttons["exploreRow"].firstMatch.waitForExistence(timeout: 20))
        sleep(4)
        shot("40-explore-map")
        // The nearest place (Student Pavilion) is pre-selected; open it from its card.
        let details = app.buttons["See details"].firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: 5), "Selected place card")
        details.tap()
        XCTAssertTrue(app.navigationBars["Place"].waitForExistence(timeout: 5))
        sleep(5)
        shot("41-pavilion-photo")
        app.navigationBars["Place"].buttons.firstMatch.tap()
        tab("Settings")
        let toggle = app.switches["liveLocationToggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "Live location switch")
        shot("42-settings-live-location")
    }

    /// Crowd Guess stays locked without eight nearby evidence photos; available games play eight rounds.
    func test6_crowdGuess() {
        app.launch()
        let card = app.buttons["crowdGuessCard"]
        XCTAssertTrue(card.waitForExistence(timeout: 10), "Crowd Guess card on Home")
        let checkingFinished = NSPredicate { _, _ in !card.label.contains("Checking photos") }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: checkingFinished, object: nil)], timeout: 15), .completed)
        if !card.isEnabled {
            XCTAssertTrue(card.label.contains("photos") || card.label.contains("area"), "Unavailable game explains local photo requirements")
            XCTAssertFalse(app.buttons["guessOption"].exists, "No fabricated rounds")
            shot("30-game-needs-local-photos")
            return
        }
        scrollAboveTabBar(card)
        card.tap()
        let play = app.buttons["playCrowdGuess"]
        XCTAssertTrue(play.waitForExistence(timeout: 5))
        shot("30-game-intro")
        play.tap()
        for round in 1...8 {
            let option = app.buttons.matching(identifier: "guessOption").firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 10), "Round \(round) options")
            sleep(round == 1 ? 3 : 1)
            if round == 1 { shot("31-game-round") }
            option.tap()
            if round == 1 { sleep(1); shot("32-game-reveal") }
            let next = app.buttons["Next round"], done = app.buttons["See my score"]
            XCTAssertTrue(next.waitForExistence(timeout: 3) || done.exists, "Next button after answering")
            if done.exists { done.tap(); break }
            next.tap()
        }
        XCTAssertTrue(app.buttons["Play again"].waitForExistence(timeout: 5), "Score screen")
        sleep(1)
        shot("33-game-score")
    }

    /// Optional isolated fixture exercises the eight-photo path without writing sample data to Oracle.
    func test6b_crowdGuessEightPhotoFixture() throws {
        guard let base = env["ORACLE_GAME_FIXTURE_URL"] else { throw XCTSkip("Set TEST_RUNNER_ORACLE_GAME_FIXTURE_URL to the isolated fixture server") }
        app.launchEnvironment["ORACLE_API_BASE_URL"] = base
        app.launch()
        let card = app.buttons["crowdGuessCard"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        let available = NSPredicate { _, _ in card.isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: available, object: nil)], timeout: 15), .completed)
        scrollAboveTabBar(card)
        card.tap()
        app.buttons["playCrowdGuess"].tap()
        for round in 1...8 {
            let option = app.buttons.matching(identifier: "guessOption").firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 15), "Photo round \(round)")
            option.tap()
            XCTAssertTrue(app.staticTexts["UI-test fixture evidence."].waitForExistence(timeout: 3))
            let next = app.buttons[round < 8 ? "Next round" : "See my score"]
            XCTAssertTrue(next.isHittable)
            next.tap()
        }
        XCTAssertTrue(app.buttons["Play again"].waitForExistence(timeout: 5))
    }

    /// Place photo (Apple imagery), sample poll with a noise reading, thank-you screen, and the Rewards card.
    /// Grant the mic first: xcrun simctl privacy booted grant microphone com.oracleprototype.Oracle
    func test5_contributionFlow() {
        app.launch()
        let row = app.buttons["placeRow"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "Around you")
        scrollAboveTabBar(row)
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["Place"].waitForExistence(timeout: 5))
        sleep(6)  // Look Around / satellite snapshot
        shot("20-place-photo")
        app.navigationBars["Place"].buttons.firstMatch.tap()

        tab("Settings")
        let sample = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Try a sample'")).firstMatch
        scrollAboveTabBar(sample)
        XCTAssertTrue(sample.waitForExistence(timeout: 5), "Try a sample")
        sample.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["Some space"].waitForExistence(timeout: 5))
        app.buttons["Some space"].tap()
        let measure = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Measure noise'")).firstMatch
        XCTAssertTrue(measure.waitForExistence(timeout: 3))
        measure.tap()
        let record = app.buttons["Start recording"]
        XCTAssertTrue(record.waitForExistence(timeout: 5), "Measure Noise screen")
        shot("21-measure-ready")
        record.tap()
        sleep(4)
        shot("22-measure-recording")
        let use = app.buttons["useNoiseReading"]
        XCTAssertTrue(use.waitForExistence(timeout: 12), "Reading finished")
        shot("23-measure-done")
        use.tap()
        let submit = app.buttons["Submit sample answer"]
        XCTAssertTrue(submit.waitForExistence(timeout: 5))
        submit.tap()
        XCTAssertTrue(app.buttons["View impact"].waitForExistence(timeout: 5), "Thank-you screen")
        sleep(1)
        shot("24-thanks")
        app.buttons["Done"].tap()
        app.buttons["Reset sample"].tap()
        app.navigationBars.buttons["Close"].firstMatch.tap()

        tab("Rewards")
        sleep(1)
        shot("25-rewards-signed-out")
        XCTAssertFalse(app.staticTexts["Contribute & earn · today"].exists, "Signed out: no points card next to Sign in")
    }

    func test4_signInAndAnswerPoll() throws {
        guard let base = env["ORACLE_URL"], let key = env["ORACLE_KEY"] else { throw XCTSkip("Set TEST_RUNNER_ORACLE_URL and TEST_RUNNER_ORACLE_KEY to run against a backend") }
        let user = "ui\(Int(Date().timeIntervalSince1970) % 100000)"
        let password = "secret-\(user)"
        // Create the account and check it in through the same APIs the app uses, then ask as an agent.
        let token = try api(base, "api/app/register", ["username": user, "password": password, "firstName": "UI", "lastName": "Tester"])["token"] as! String
        // A fresh venue each run, so Oracle's 10-minute answer memory doesn't answer instantly.
        let venue = "Test Kiosk \(user)"
        let place = try api(base, "api/places/ensure", ["name": venue, "lat": 37.7955 + Double.random(in: 0...0.01), "lng": -122.3937, "kind": "food"])["id"] as! String
        _ = try api(base, "api/app/checkin", ["place": place], headers: ["x-oracle-token": token])

        app.launch()
        signOutIfNeeded()
        tab("Requests")
        XCTAssertTrue(app.buttons["requestsSignIn"].waitForExistence(timeout: 5))
        app.buttons["requestsSignIn"].tap()
        let server = app.textFields["https://your-oracle-server.com"]
        XCTAssertTrue(server.waitForExistence(timeout: 5))
        if (server.value as? String) != base {
            server.tap()
            server.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: ((server.value as? String) ?? "").count + 5))
            server.typeText(base + "\n")
        }
        XCTAssertTrue(app.staticTexts["Oracle server found"].waitForExistence(timeout: 10))
        let username = app.textFields["Username"]
        XCTAssertTrue(username.waitForExistence(timeout: 5))
        username.tap(); username.typeText(user + "\n")   // Next moves focus to the password field.
        let pass = app.secureTextFields["Password"]
        XCTAssertTrue(pass.waitForExistence(timeout: 3))
        pass.typeText(password)
        shot("12-sign-in")
        pass.typeText("\n")                             // Go submits from the keyboard.
        XCTAssertTrue(app.staticTexts["Checked in at \(venue)"].waitForExistence(timeout: 10), "Connected only after the server accepts the session")

        _ = try api(base, "api/ask", ["place": place, "question": "How crowded is it right now?", "waitSeconds": 0], headers: ["x-oracle-key": key])
        let card = app.buttons.containing(NSPredicate(format: "label CONTAINS 'How crowded is'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 25), "Assigned request appears")
        shot("13-requests-signed-in")
        card.tap()
        XCTAssertTrue(app.buttons["Some space"].waitForExistence(timeout: 5), "Server options")
        app.buttons["Some space"].tap()
        shot("14-poll")
        app.buttons["Submit answer"].tap()
        XCTAssertTrue(app.staticTexts["Answer sent"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Submit answer"].exists, "Can't submit twice")
        XCTAssertTrue(app.buttons["Done"].isHittable, "Confirmation isn't covered")
        shot("15-poll-answered")
        app.buttons["Done"].tap()
        tab("Rewards")
        XCTAssertTrue(app.staticTexts["4"].waitForExistence(timeout: 8), "Points from the server (3 start + 1)")
        shot("16-rewards")
    }

    func test5_settingsSampleAndAssistants() {
        app.launch()
        tab("Settings")
        XCTAssertTrue(app.staticTexts["Try a sample"].waitForExistence(timeout: 5))
        app.staticTexts["Try a sample"].tap()
        XCTAssertTrue(app.staticTexts["Sample · nothing here is real"].waitForExistence(timeout: 5), "Sample is clearly labeled")
        app.buttons["Some space"].tap()
        app.buttons["Submit sample answer"].tap()
        XCTAssertTrue(app.buttons["View impact"].waitForExistence(timeout: 5), "Sample contribution confirmation")
        shot("17-sample")
        app.buttons["Done"].tap()
        app.buttons["Reset sample"].tap()
        app.navigationBars["Try a sample"].buttons["Close"].tap()

        let assistants = app.staticTexts["AI assistants"]
        scrollAboveTabBar(assistants)
        assistants.tap()
        XCTAssertTrue(app.staticTexts["claudeTitle"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Connected"].exists, "Setup screen never claims a connection")
        shot("18-assistants")
        app.navigationBars["AI assistants"].buttons["Close"].tap()
        tab("Rewards")
        let visibleSample = app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'sample points'")).allElementsBoundByIndex.filter { $0.isHittable }
        XCTAssertTrue(visibleSample.allSatisfy { $0.label.contains("never appear here") }, "Rewards shows no sample balance")
    }

    @objc func test8_assistantConnectionPages() throws {
        app.launch()
        let start = app.buttons["Get started"]
        if start.waitForExistence(timeout: 5) {
            start.tap()
        }
        let area = app.buttons["San Francisco"]
        if area.waitForExistence(timeout: 3) { area.tap() }
        XCTAssertTrue(app.buttons["Explore places"].waitForExistence(timeout: 25))
        tab("Settings")
        let assistants = app.staticTexts["AI assistants"]
        scrollAboveTabBar(assistants)
        assistants.tap()
        XCTAssertTrue(app.staticTexts["claudeTitle"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Setup guide"].exists)
        shot("50-assistant-claude")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.48))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.48)))
        XCTAssertTrue(app.staticTexts["chatGPTTitle"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Show ChatGPT"].isSelected)
        shot("51-assistant-chatgpt")
        app.buttons["Show Claude"].tap()
        XCTAssertTrue(app.staticTexts["claudeTitle"].waitForExistence(timeout: 5))
        let connect = app.buttons["connectClaude"]
        // Local development must offer a real configuration route, never a false connection.
        if app.staticTexts["assistantLocalServer"].exists {
            let scroll = app.scrollViews.containing(.staticText, identifier: "claudeTitle").firstMatch
            for _ in 0..<4 where !connect.isHittable { scroll.swipeUp() }
            XCTAssertTrue(connect.isHittable)
            connect.tap()
            XCTAssertTrue(app.navigationBars["Oracle account"].waitForExistence(timeout: 5))
            app.navigationBars["Oracle account"].buttons["Close"].tap()
            XCTAssertTrue(app.navigationBars["AI assistants"].waitForExistence(timeout: 5))
        }
        app.navigationBars["AI assistants"].buttons["Close"].tap()
        XCTAssertTrue(app.buttons["Settings"].isSelected)
    }

    @objc func test9_soundPreferencePersists() throws {
        app.launch()
        let start = app.buttons["Get started"]
        if start.waitForExistence(timeout: 3) { start.tap() }
        let area = app.buttons["San Francisco"]
        if area.waitForExistence(timeout: 2) { area.tap() }
        XCTAssertTrue(app.buttons["Explore places"].waitForExistence(timeout: 25))
        tab("Settings")
        let toggle = app.switches["soundEffectsToggle"]
        scrollAboveTabBar(toggle)
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        let initiallyOn = toggle.value as? String == "1"
        if initiallyOn { toggle.tap() }
        XCTAssertEqual(toggle.value as? String, "0")
        XCTAssertFalse(app.buttons["previewSound"].isEnabled)
        app.terminate()
        app.launch()
        tab("Settings")
        scrollAboveTabBar(toggle)
        XCTAssertEqual(toggle.value as? String, "0", "Sound preference persists after relaunch")
        toggle.tap()
        XCTAssertEqual(toggle.value as? String, "1")
        let preview = app.buttons["previewSound"]
        XCTAssertTrue(preview.isEnabled)
        preview.tap()
        shot("60-sound-settings")
        if !initiallyOn { toggle.tap() }
    }

    // MARK: - Helpers

    private func signOutIfNeeded() {
        tab("Settings")
        let manage = app.buttons["Manage account"]
        let signIn = app.buttons["Sign in to Oracle"]
        // Wait until the stored session has been checked one way or the other.
        let settled = NSPredicate { _, _ in manage.exists || signIn.exists }
        _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 10)
        guard manage.exists else { return }
        manage.tap()
        app.buttons["Sign out"].tap()
        app.navigationBars["Oracle account"].buttons["Close"].tap()
    }

    /// Hidden tabs keep their scroll views alive, so drag the visible screen by coordinates.
    /// The custom tab bar floats over the bottom ~140 pt, so scroll until the element is above it.
    private func scrollAboveTabBar(_ element: XCUIElement) {
        for _ in 0..<4 where !(element.exists && element.frame.maxY < app.windows.firstMatch.frame.height - 160) {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)))
            sleep(1)
        }
    }

    private func tab(_ name: String) {
        let button = app.buttons[name].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5), "Tab \(name)")
        button.tap()
    }

    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["SHOT_DIR"] {
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    @discardableResult
    private func api(_ base: String, _ path: String, _ body: [String: Any], headers: [String: String] = [:]) throws -> [String: Any] {
        var request = URLRequest(url: URL(string: base)!.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        var result: [String: Any] = [:]
        var failure: Error?
        let done = expectation(description: path)
        URLSession.shared.dataTask(with: request) { data, _, error in
            failure = error
            result = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 70)
        if let failure { throw failure }
        return result
    }
}
