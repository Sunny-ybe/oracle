# Oracle for iPhone

Open Oracle.xcodeproj in Xcode, select an iPhone Simulator, and run. Continue as guest for place discovery or choose Sign in to Oracle to configure your team's server. The native client serves people anywhere. ASU is an optional demo area.

## Screens

- Home offers Explore places, Answer & earn, location, city/venue search, the optional ASU demo, and AI assistant setup.
- Explore uses MapKit and real venue search. Selecting a place opens its reports, source, timestamp and votes, a Google Maps link, and an explicit check-in button.
- Requests shows questions assigned by Oracle to your account and refreshes every 15 seconds while visible. The live poll uses the server's options and submits a one-based answer. A successful response shows the server's message and points. Photo and sensor requests open the existing Oracle web capture flow, where a separate web sign-in may be required.
- Rewards reads your server points, trust, and available gift cards. Gift-card redemption records a manual fulfillment request. Wallet linking uses the existing backend. Solana payouts remain devnet.

## Connect the backend

The backend lives at the repository root, two folders above this directory. Install its dependencies with npm ci, configure its .env using .env.example, and run npm start. MongoDB and Tiger Data are required by that server. Deploy it behind an HTTPS address accessible from the iPhone.

In the iPhone app, open Settings → Sign in to Oracle and enter that HTTPS server address. Save it, then create an Oracle username/password account or sign in to an existing one. The session token is stored in the iPhone Keychain. Sign in with Apple from the earlier welcome screen remains a local entry option and does not create an Oracle server account.

Search, venue photos, requests, and rewards use that server after configuration. MapKit search also works before sign-in. Check-in happens only when the person taps “I’m here”. Searching or selecting a venue does not check them in.

## Provider settings

Set GEMINI_API_KEY in the backend .env to enable Gemini search interpretation and the repository's existing question planning and image verification. The selected GEMINI_MODEL must be available to that key. Actual venue coordinates come from MapKit search.

Set GOOGLE_PLACES_API_KEY on the backend and enable Places API (New) to retrieve venue photos. The server first checks for an Oracle privacy-masked contributor photo. Google photos retain their author attribution and are labeled as venue imagery. Missing photos show an icon. Generated images are never represented as current evidence of a place.

The embedded map uses MapKit. “Open in Google Maps” opens the selected coordinates through a universal Google Maps URL. A Google Maps iOS SDK map is not included.

## AI assistants and MCP

The Home assistant card opens two swipeable pages: Claude on the left and ChatGPT on the right. Each has its provider logo, three setup steps, a connect button and an App Store link. There are no divider panels. Server details, copy/share actions and provider guides are under “Server address & help”.

Set PUBLIC_URL in the backend to its public HTTPS origin. The app reads mcp.url from /api/app/config, falling back to the configured native server address plus /mcp for older servers. Local/private addresses offer “Configure server”, which opens the existing server settings.

With a public endpoint and known authentication, Connect Claude copies the address and opens the prefilled custom-connector setup in an in-app browser. If iOS or sign-in drops the prefill, the help section provides the manual path and copied address. Connect ChatGPT copies the address and opens chatgpt.com/plugins for Add custom MCP server, then create/install. Both require approval in the provider; they do not silently install a plugin or claim “Connected”. API-key-only servers block ChatGPT connection until compatible OAuth is configured. No credential is added to a shared URL.

Settings and the Home assistant card use the existing /mcp server. This backend now provides stateless Streamable HTTP at POST /mcp, sharing all five tools with the original mcp/oracle-mcp.js stdio server. ORACLE_URL must point to the backend's internal REST address. ORACLE_API_KEY, when configured, is required in x-oracle-key for remote MCP requests and REST agent calls. Clients must support that header, or an authentication gateway compatible with the assistant must be deployed. OAuth account linking is not implemented in the iPhone app or this MCP server.

Claude Desktop can continue to use the README configuration in the repository root README. Remote Claude and ChatGPT connections are created in those products on a supported surface. Their authentication and plan requirements apply. Opening a provider setup guide or sharing the MCP address does not mark an account connected.

## Verification

The iOS Simulator build passes. Remote MCP initialization and listing all five tools were exercised locally. Location validation and search fallback were exercised. Full database-backed voting, provider photos, Gemini calls, and assistant account authorization require the team's configured services and have not been verified end to end.

## Location-based Crowd Guess

The header uses the same face artwork as the app icon. Crowd Guess requires eight distinct photos with matching resolved crowd or headcount reports within 3 km of the chosen location or searched area. The card shows availability and stays disabled until enough evidence exists. All eight images must load before play begins. Each answer reveals its contributor observation, report source, votes and dates. Game scores stay separate from Oracle reward points. Automatic practice rounds have been removed.

The backend route GET /api/game/rounds requires lat and lng. Its response contains minimumPhotos, availablePhotos, radiusM and rounds. Under eight eligible photos, rounds is empty. The rules can be checked with node scripts/test-game.js.

## Launch and sounds

The loading view uses the face-only app icon on layered paper tiles, small floating location/chat accents, and animated dots. It follows Reduce Motion and stays visible for two seconds before transitioning; it does not wait for a network response or show invented progress.

Settings → Sound effects enables or mutes short original tones for tab/screen navigation, waving to Ora, contribution confirmations and Crowd Guess feedback. “Try a sound” previews the mascot chirp. The preference persists after relaunch. PCM audio is synthesized locally in Voice.swift; no downloaded sound files or provider keys are required. Ambient audio follows Silent Mode and mixes with other apps. Sounds stop in the background and are suppressed during dictation and noise measurement.

Verification: iOS device Release build and the sound-preference persistence/preview UI test passed. All four generated WAV cues were decoded and checked for valid PCM, short duration, smooth endpoints and no clipping. Physical-device speaker/Silent Mode behavior still needs device verification.

## TestFlight preparation

Open `ios/Oracle/Oracle.xcodeproj` from the repository root. Select your Apple Developer team and the registered bundle identifier in Signing & Capabilities. Configure the public HTTPS backend address (in Settings, or `OracleSession.productionServer` for a shared build). Set up Sign in with Apple and Push Notifications for that identifier if used, with matching backend `APNS_BUNDLE_ID`. Choose a generic iOS device, Archive in Xcode, then distribute through App Store Connect to TestFlight. No signing certificates, provisioning profiles or `.env` belong in Git. Signed archive/upload has not been performed.
