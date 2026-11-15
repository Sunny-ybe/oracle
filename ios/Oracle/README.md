# Oracle for iPhone

Open Oracle.xcodeproj in Xcode, select an iPhone Simulator, and run. Continue as guest for place discovery or choose Sign in to Oracle to configure your team's server. The native client serves people anywhere. ASU is an optional demo area.

## Screens

- Home offers Explore places, Answer & earn, location, city/venue search, the optional ASU demo, and AI assistant setup.
- Explore uses MapKit and real venue search. Selecting a place opens its reports, source, timestamp and votes, a Google Maps link, and an explicit check-in button.
- Requests shows questions assigned by Oracle to your account and refreshes every 15 seconds while visible. The live poll uses the server's options and submits a one-based answer. A successful response shows the server's message and points. Photo, noise, Wi-Fi and headcount requests are answered in the app: a tap always works, and a photo, a 10-second noise reading, a Wi-Fi speed test (two 1 MB downloads of `/speedtest.bin`, faster run sent as `mbps`) or a typed number of people (sent as `count`) can stand in for it on the matching request type.
- Rewards reads your server points, trust, and available gift cards. Gift-card redemption records a manual fulfillment request. Wallet linking uses the existing backend. Solana payouts remain devnet.

## Connect the backend

The backend lives at the repository root, two folders above this directory. Install its dependencies with npm ci, configure its .env using .env.example, and run npm start. MongoDB and Tiger Data are required by that server. Deploy it behind an HTTPS address accessible from the iPhone.

The app starts connected to the team's live server, `https://oracle.tryalethea.com` (`OracleSession.productionServer`), on both the Simulator and a real iPhone. To use another server, open Settings → Sign in to Oracle and enter its HTTPS address (`http://localhost:3000` works on the Simulator only), or launch with `ORACLE_API_BASE_URL` set. Then create an Oracle username/password account or sign in to an existing one. The session token is stored in the iPhone Keychain. Sign in with Apple from the earlier welcome screen remains a local entry option and does not create an Oracle server account.

Search, venue photos, requests, and rewards use that server after configuration. MapKit search also works before sign-in. Check-in happens only when the person taps “I’m here”. Searching or selecting a venue does not check them in.

## Provider settings

Set GEMINI_API_KEY in the backend .env to enable Gemini search interpretation and the repository's existing question planning and image verification. The selected GEMINI_MODEL must be available to that key. Actual venue coordinates come from MapKit search.

Set GOOGLE_PLACES_API_KEY on the backend and enable Places API (New) to retrieve venue photos. The server first checks for an Oracle privacy-masked contributor photo. Google photos retain their author attribution and are labeled as venue imagery. Missing photos show an icon. Generated images are never represented as current evidence of a place.

The embedded map uses MapKit. “Open in Google Maps” opens the selected coordinates through a universal Google Maps URL. A Google Maps iOS SDK map is not included.

## AI assistants and MCP

The Home assistant card and Settings → AI assistants open two swipeable pages, Claude and ChatGPT. Each has its provider logo, three setup steps, a Connect button, an App Store link and a "Server address & help" section with the address, Copy and Share, and the guides.

- **Address:** Connect uses the app's own server's `mcp.url` when it is public HTTPS, otherwise Oracle's public server `https://oracle.tryalethea.com/mcp` (Authentication: None). Cloud assistants can't reach a local server, so the button no longer turns into "Configure server" on a local setup. It still does for a non-public server that needs an API key ChatGPT can't send.
- **Connect:** copies the address, then opens the provider's setup link with Oracle's name and address filled in (Claude: `claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Oracle&connectorUrl=…`; ChatGPT: `chatgpt.com/plugins`). It opens with `universalLinksOnly`, so iOS opens it only in the provider's installed app; if the app isn't installed, the App Store page opens. No private URL schemes are used.
- **Not silent:** neither provider lets another app add a connector silently, so the person taps Add (Claude) or Add custom MCP server → Create (ChatGPT). The Claude pre-filled link isn't in Anthropic's public docs, and ChatGPT documents custom MCP servers as web-only, so a provider app may not show the setup form. "Set up on the web instead" in the help section opens the same link in an in-app browser.
- **Not verified:** the app never shows "Connected"; Oracle can't read assistant settings.

Provider docs checked November 2026: Claude https://support.claude.com/en/articles/11175166 · ChatGPT https://developers.openai.com/plugins/deploy/connect-chatgpt.

## Push notifications

- **Flow:** the app asks for permission (alert, sound, badge) after an Oracle sign-in, or from Settings → Notifications. It registers with Apple Push on every launch when allowed, and sends the device token, its APNs environment and the chosen sound to `POST /api/app/apns`. A new token from iOS is uploaded again. Signing out calls `POST /api/app/apns/remove`, clears delivered Oracle alerts and resets the badge.
- **Environment:** the app reads `aps-environment` from the build's provisioning profile: development-signed builds use the sandbox; TestFlight and App Store builds (production, or no embedded profile) use production. If Apple answers BadDeviceToken, the server retries the other environment once and remembers it.
- **Payload:** the request rides in the payload, with title, distance subtitle, the question as body, a `poll.<options>` category for answer buttons, `thread-id`, `interruption-level: active`, a 15-minute `apns-expiration`, the bundled `oracle-chime.caf` (or the iPhone default sound if the person chose that), and a badge equal to the person's open requests.
- **Tapping:** a notification opens that request (cold launch included). Answer buttons send the answer without opening the app.
- **Settings → Notifications:** shows the current permission and the Lock Screen, banner, sound and badge settings. It offers Turn on notifications (not asked yet) or Open iPhone Settings (denied), a sound choice, and a test alert. It also says when the server has no APNs key. Alerts follow the person's notification settings, Focus and Silent Mode. Oracle doesn't use Time Sensitive or Critical alerts.
- **Sound:** `oracle-chime.caf` is an original 1.25-second two-note chime synthesized for Oracle (16-bit PCM CAF).

## TestFlight preparation

Open `ios/Oracle/Oracle.xcodeproj` from the repository root. Select your Apple Developer team and the registered bundle identifier in Signing & Capabilities. Configure the public HTTPS backend address (in Settings, or `OracleSession.productionServer` for a shared build). Push Notifications and Sign in with Apple are in `Oracle.entitlements`. Keep `aps-environment` = `development` there: Xcode switches it to `production` when it exports the archive for App Store Connect / TestFlight. In the Apple Developer portal, the App ID needs the Push Notifications capability. Create an APNs auth key (.p8) and put it on the server only, as `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_BUNDLE_ID` (the app's bundle identifier). `/api/app/config` → `integrations.apns` shows whether the server can push. Choose a generic iOS device, Archive in Xcode, then distribute through App Store Connect to TestFlight. No signing certificates, provisioning profiles or `.env` belong in Git. Signed archive/upload has not been performed.
