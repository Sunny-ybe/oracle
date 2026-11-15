# Decisions

The single record of architecture and product decisions. Newest at the bottom. Add a new entry instead of editing an old one; to reverse an old decision, add an entry that supersedes it and mark the old one `Superseded by D-xxx`.

Format: **D-NNN: title** · date · status. Then *Decision* and *Why*, plus *Where* (code) when useful.

---

**D-001: Free tiers only** · before 2026-11-15 · Active
- *Decision:* No service may cost money: MongoDB Atlas free, Tiger/Timescale free, Gemini free tier, Solana **devnet**, free tunnels.
- *Why:* Hackathon budget is zero.

**D-002: Two databases, split by data shape** · before 2026-11-15 · Active
- *Decision:* MongoDB holds documents (users, places, questions, photos, settings). Tiger/Timescale holds time series (answers, trends, payouts, noise).
- *Why:* Trends and busiest-hours queries are time-bucketed SQL. Profiles and questions are flexible documents.
- *Where:* `src/db/mongo.js`, `src/db/tiger.js`, `schema.sql`.

**D-003: Core is channel-agnostic** · before 2026-11-15 · Active
- *Decision:* `src/core.js` owns all logic. Telegram, Discord and the web app register as channels exposing `sendPoll` and `sendText`. `server.js` is a thin router.
- *Why:* Adding a channel shouldn't touch consensus or payout logic.

**D-004: Open questions live in memory; one server at a time** · before 2026-11-15 · Active
- *Decision:* Open questions sit in the in-process `live` Map. Only one machine runs the server and bots at a time (Telegram long-polling also conflicts across machines).
- *Why:* Simple and fast for a demo. The cost is that votes reaching the wrong machine are lost. Bot tokens stay commented out in `.env` except on the machine that's running them.

**D-005: Trust-weighted consensus** · before 2026-11-15 · Active
- *Decision:* An answer settles when ≥ `MIN_VOTES` (3) matching votes have trust weight ≥ `MIN_WEIGHT`. Trust goes up when a person agrees with the consensus and down when they don't. At 5 split votes, the most trusted nearby person gets a GPS-checked photo link (`/verify/:token`).
- *Why:* Resists a single liar without needing ground truth.
- *Where:* `RULES` in `src/config.js`, `recordVote` and `checkConsensus` in `src/core.js`.

**D-006: Answers are cached as memory** · before 2026-11-15 · Active
- *Decision:* A settled answer younger than `CACHE_MINUTES` (10) is served instantly without pinging anyone.
- *Why:* Repeat asks are free and instant. It's also the product pitch ("every answer becomes memory").

**D-007: Few people → photo instead of a 3-vote poll** · 2026-11-15 · Active
- *Decision:* If a poll reaches fewer than `MIN_VOTES` people, it becomes a `photo` question (`q.fewPeople`). One Gemini-verified photo settles it and pays. A tap without a photo settles as low-confidence and "unverified", with no payout.
- *Why:* 3-vote consensus can't be reached when only 1–2 people are around.
- *Where:* `ask`, `checkConsensus`, `finalize` and `onDeadline` in `src/core.js`.

**D-008: History fallback replaces web scraping** · 2026-11-15 · Active
- *Decision:* When nobody answers, or nobody is nearby (answered immediately, with no 90 s wait), Oracle tries in order: the last people report at this place (`past_report`) → the same topic at a similar place plus a Gemini estimate (`similar_place`) → a labeled AI estimate (`estimate`) → `none`. None of these pay out. TinyFish is no longer called.
- *Why:* Web pages can't answer live questions ("how long is the line right now?"). Real past reports are more honest.
- *Where:* `answerFromHistory` in `src/core.js`, `lastAnswer` and `sameTopicElsewhere` in `src/db/tiger.js`, `estimateAnswer` in `src/ai/gemini.js`.

**D-009: Dedicated `SESSION_SECRET` for app sign-in** · 2026-11-15 · Active
- *Decision:* App tokens are HMAC-signed with `SESSION_SECRET` first, falling back to `ORACLE_API_KEY`, then `TELEGRAM_TOKEN`. Every machine must use the same value.
- *Why:* Machines without a Telegram token signed with the public string `oracle-dev`, so sign-ins could be forged and users were logged out when switching laptops.
- *Where:* `src/web/auth.js`, `src/config.js`.

**D-010: iMessage/SMS channel postponed** · 2026-11-15 · Deferred
- *Decision:* Not now. The only free route would be AppleScript plus reading `chat.db` on a Mac with Full Disk Access.
- *Why:* There's no Apple API, and it's fragile. Other channels come first.

**D-011: Permanent public URL** · 2026-11-15 · Superseded by D-014
- *Decision:* Preferred: a Cloudflare named tunnel on a team domain (free, no warning page, same URL from any laptop through `TUNNEL_TOKEN`). Fallback without a domain: an ngrok free static domain (shows a one-time warning page).
- *Why:* The quick-tunnel URL changes every run, which breaks QR codes, Telegram links and claude.ai connectors.

**D-012: Agent docs layout** · 2026-11-15 · Active
- *Decision:* `AGENTS.md` is the entry point and map. `docs/DECISIONS.md` is the only place decisions live. `HANDOFF.md` holds current status and priorities. `CLAUDE.md` just imports `AGENTS.md`.
- *Why:* Keeps agent context small: read one short map, then follow pointers.

**D-013: Rewards — photo 0.01 SOL, tap 0.001 SOL; "unverified" only when few people** · 2026-11-15 · Active
- *Decision:* Any matching vote that carries a Gemini-read photo earns `REWARD_PHOTO_SOL` (0.01). A tap earns `REWARD_VOTE_SOL` (0.001). The dispute photo is paid once, in `submitPhoto`. The "a tap alone isn't proof" rule from D-007 applies only to few-people questions. Normal photo questions still settle on 3 matching taps.
- *Why:* Photos had been paid like taps, and the D-007 rule had accidentally marked every tap-only photo question unverified.
- *Where:* `finalize` and `settle` in `src/core.js`.

**D-014: Native iPhone app in the same repository** · 2026-11-15 · Active
- *Decision:* Keep the SwiftUI app under `ios/Oracle`, with the backend at the root. Prepare the integration on `native-ios`; merge into main after team review. TestFlight distribution uses Xcode/App Store Connect, with signing credentials and environment files excluded from Git.
- *Why:* The client and backend share one product and API contract. The user explicitly requested the same-repo native branch push.
- *Where:* `ios/Oracle`, `NATIVE.md`.

**D-015: Worldwide places and evidence-gated Crowd Guess** · 2026-11-15 · Active
- *Decision:* Native discovery uses live location or manual city/venue search; ASU is an example, not the audience boundary. Crowd Guess requires eight distinct photo-backed resolved crowd/headcount reports within 3 km of the selected area, with matching answer evidence and timestamps. No unrelated practice rounds are substituted.
- *Why:* Answers and game photos must correspond to the chosen place and have inspectable evidence.
- *Where:* `src/web/native.js`, `src/web/game.js`, `scripts/test-game.js`, `ios/Oracle/Oracle/CrowdGuess.swift`.

**D-016: Assistant setup reuses the MCP tools with explicit provider approval** · 2026-11-15 · Active
- *Decision:* Expose the original five MCP tools through Streamable HTTP at `/mcp`, retaining stdio compatibility. Native setup uses two swipeable provider pages, a prefilled Claude connector link, and ChatGPT Plugins setup. Public HTTPS is required. No silent plugin installation or unverified Connected status; API-key-only ChatGPT setup needs compatible OAuth.
- *Why:* Reuse the existing agent capability while respecting each assistant's setup and authentication flow.
- *Where:* `mcp/`, `/api/app/config`, `ios/Oracle/Oracle/Settings.swift`.

**D-017: Consistent mascot, two-second loading view, optional interface sounds** · 2026-11-15 · Active
- *Decision:* Use the face-only app icon in the wordmark/loading view, show the loading animation for two seconds, and provide short locally generated interface tones with a persistent Settings switch. Respect Reduce Motion and Silent Mode; suppress tones while recording.
- *Why:* The user requested consistent branding, more time to see the loader, and subtle sound effects.
- *Where:* `ios/Oracle/Oracle/ContentView.swift`, `Theme.swift`, `Voice.swift`, `Settings.swift`.

**D-014: Public link — ngrok fixed domain now, `oracle.tryalethea.com` when DNS allows** · 2026-11-15 · Active
- *Decision:* `scripts/start.sh` picks the link in this order: Cloudflare named tunnel (`TUNNEL_TOKEN` + `PUBLIC_DOMAIN`), then ngrok fixed domain (`NGROK_DOMAIN`), then a quick tunnel. Today the demo runs on `https://swarm-exemplify-verbalize.ngrok-free.dev` (the user's ngrok account domain). The target is `oracle.tryalethea.com`.
- *Why:* The team has no Oracle domain. The user owns `tryalethea.com`, but its DNS is at GoDaddy, and a free Cloudflare tunnel needs the domain's nameservers on Cloudflare. ngrok was already logged in on the demo Mac, so it gave a fixed link at once. Browsers see ngrok's one-time notice page; API clients such as claude.ai do not.
- *Where:* `scripts/start.sh`, `.env.example`.

**D-015: Remote MCP at `/mcp` is stateless and open while `ORACLE_API_KEY` is empty** · 2026-11-15 · Active
- *Decision:* claude.ai connects to `<public link>/mcp` (Streamable HTTP, one server per request, added in the iOS merge). `ORACLE_API_KEY` stays empty for the demo, so `/mcp`, `/api/ask` and `/api/dev/*` accept anyone who has the link.
- *Why:* A claude.ai custom connector can be added with just a URL. Setting the key would lock out the connector unless it can send the key. Accepted risk for a hackathon demo: anyone with the link could cast fake dev votes.
- *Where:* `mcp/http.js`, `mcp/tools.js`, `requireKey` in `src/server.js`.

**D-016: `GEO_BIAS` must be set in `.env`; live location beats a check-in** · 2026-11-15 · Active
- *Decision:* Since the iOS merge, the ASU home area is no longer a code default. `.env` sets `GEO_BIAS=33.4242,-111.9281`; without it, place lookups are worldwide and no campus places are auto-imported. A phone's live location now overrides an earlier QR check-in (`setLocation` in `src/db/mongo.js`).
- *Why:* The iPhone app is meant to work anywhere, so the area became configuration.

**D-017: Wi-Fi is a question type; bots hand off to the web app by link** · 2026-11-15 · Active
- *Decision:* Gemini can plan a `wifi` question (Slow / Okay / Fast, thresholds 10 and 50 Mbps). The web app answers it with the 1 MB speed test. Telegram and Discord cannot measure a connection, so their message adds a personal link (`/app?q=…&t=…`) that opens the same request in the browser as that person. Discord sends the link by DM only. Noise readings take 10 seconds.
- *Why:* The user wants Wi-Fi answered by a real measurement, like noise and people count. A bot cannot run code on a phone. The per-channel abilities are in `docs/CHANNELS.md`.
- *Where:* `planQuestion` in `src/ai/gemini.js`, `submitReading` in `src/core.js`, `speedTest` in `public/app.html`, `sendTask` in the channel files.

**D-018: A phone measurement stands at the deadline** · 2026-11-15 · Active
- *Decision:* At the 90 s deadline, a people-count, noise or Wi-Fi question with at least one measured reading settles as a normal answer (and pays), even if fewer than `MIN_VOTES` people answered. Tap-only answers still need consensus.
- *Why:* A count read from a photo or a measured speed is evidence in a way one tap is not. Without this, one person answering with a photo while others stayed silent gave "low confidence" and no payout.
- *Where:* `onDeadline` in `src/core.js`.

**D-019: Every question settles within 40 seconds** · 2026-11-15 · Active
- *Decision:* `deadlineSeconds` is 40 (`DEADLINE_SECONDS`), down from 90. `ask_place` waits 45 s, so Claude gets the settled answer in the same tool call. At the deadline a question settles as: consensus, a phone measurement (D-018), one unverified answer marked low confidence, or the history fallback (D-008).
- *Why:* The user's rule: nobody waits more than 30 to 40 seconds for an answer, 60 at the very most.
- *Where:* `RULES` in `src/config.js`, `ask_place` in `mcp/tools.js`.

**D-020: People counts take a tap, a typed number or a photo; a photo alone answers a poll** · 2026-11-15 · Active
- *Decision:* Any "how many people" question is a `people_count` question with number ranges, never a crowd poll. People answer by tapping a range, typing a number, or sending a photo that Gemini counts. A typed number pays like a tap (1 point, 0.001 SOL) and is not a measurement for D-018; a photo pays 5 points and 0.01 SOL. On a plain poll, a photo sent without tapping is read by Gemini to pick the option.
- *Why:* The user wants number questions answered in numbers, with more reward for a photo, and wants "reply with a picture" to work for line questions.
- *Where:* `planQuestion` in `src/ai/gemini.js`; `submitReading`, `typedCount`, `findRequestFor` and `answerFromApp` in `src/core.js`.

**D-021: Always-on server on Vultr** · 2026-11-15 · Active
- *Decision:* Oracle also runs on a Vultr instance (Ubuntu 26.04, 1 GB, Atlanta, `YOUR_SERVER_IP`) as a systemd service `oracle` in `/opt/oracle`, behind Caddy for HTTPS. Address: `https://oracle.tryalethea.com` (a GoDaddy A record `oracle` → the IP). The Telegram bot runs here since the cutover on 2026-11-15. SSH is key-only (`~/.ssh/oracle_vultr` on the user's Mac). The firewall allows 22, 80 and 443.
- *Why:* A demo that depends on one laptop staying awake is fragile, and a real domain removes the ngrok notice page. It also makes the README's Vultr + GoDaddy section true.
- *Rules:* Only one place may run the bots (D-004). Laptops keep the bot tokens commented out. Update the server with `npm run deploy` (`scripts/deploy.sh`); it never touches the server's `.env`.

**D-022: TinyFish answers official-information questions from stored page facts** · 2026-11-15 · Active
- *Decision:* For questions about hours, schedules, menus, prices or events at a place that has a `web` entry, Oracle uses the place's official page. TinyFish reads each page in the background (at server start and when the facts are older than 3 hours), the facts are stored in Mongo `settings` (`web:<placeId>`), and Gemini answers from them. People still come first: the official answer is returned (labelled `web`, no payout) only when nobody answers; when people do answer, the official fact is attached as `official`. Lines, crowds and noise never go to the web. This narrows D-008, which stays true for live conditions.
- *Why:* The place's own site is the right source for "is it open?". A live TinyFish run takes 20 seconds to 2 minutes, which breaks the 40-second rule (D-019), so it must not run while someone waits.
- *Where:* `src/web/tinyfish.js`, `answerFromFacts` in `src/ai/gemini.js`, `ask` and `answerFromHistory` in `src/core.js`.

**D-023: The iPhone app defaults to the live server and answers Wi-Fi and people-count requests natively** · 2026-11-15 · Active (untested by hand)
- *Decision:* `ios/Oracle` connects to `https://oracle.tryalethea.com` on first launch, on the Simulator too (it used to default to `localhost:3000` there). Settings or the `ORACLE_API_BASE_URL` launch variable still override it. Wi-Fi requests run the 1 MB speed test in the app and send `mbps`; people-count requests accept a typed number sent as `count`.
- *Why:* The app should work without typing a server address, and it lacked the two answer types the web app has (D-017, D-020).
- *Watch out:* signing in from the Simulator now touches the live shared data, and UI tests that don't set `ORACLE_API_BASE_URL` reach the live server.
- *Where:* `OracleSession` in `NativeData.swift`, `SpeedTest` in `Contribute.swift`, `LivePoll` in `NativeScreens.swift`.


**D-024: The web matches the iPhone app's dark + lime look** · 2026-11-15 · Active
- *Decision:* The earner web app (`/app`), the dashboard (`/`) and the join page (`/join`) use the iPhone app's dark background, lime accent and robot mascot Ora (`public/img/ora.png`, `public/img/mark.png`, from `ios/Oracle`). `/app` gets a Home tab like the iPhone app ("The world, answered.", Explore places / Answer & earn, Start where you are, How Oracle works, Ask from Claude with the `/mcp` address), and its tabs are Home, Requests, Explore, Rewards; Profile opens from the Home menu button. The dashboard gets a collapsible "How Oracle works" panel with a "Built with" strip naming each sponsor and what it does; the panel hides while a place card is open on short screens. `/icon.png` now serves Ora's face. The theme lives in CSS variables plus one override block per page, so it is easy to revert. No logic, API or data changes.
- *Why:* The user wants the website and the iPhone app to look like one product for judging, and judges need to see each sponsor's role on screen.
- *Where:* `public/app.html`, `public/index.html`, `public/join.html`, `public/manifest.webmanifest`, `public/img/`, `/icon.png` in `src/server.js`.

**D-025: People can set their own spot on the map when GPS is wrong** · 2026-11-15 · Active
- *Decision:* In the web app (Explore → "Wrong spot?", Home → "Set my spot on the map", Profile, or by tapping the fuzzy-location toast), a person drags the map under a fixed pin and taps "Set my location here". It is sent to the existing `/api/app/checkin` with `accuracy: 10` and `manual: true` (the server ignores `manual` for now). While a hand-set pin is active, live GPS updates are not sent, so they don't overwrite it. The pin ends after 3 hours, when a good GPS fix (≤100 m) shows the person has moved more than 1.9 km away, or when they tap "share my location" again. Guard: if the phone has a decent fix (≤1 km accuracy), the pin must be within 1.5 km of it; with no fix or a fuzzy one, any spot is allowed, like a QR check-in.
- *Why:* Indoors or on Wi-Fi, phones often put people a building or a block off, so they get the wrong requests. The 1.5 km guard lets people fix a wrong spot without teleporting to collect requests elsewhere. Dispute photos still check real GPS on `/verify`.
- *Where:* `startPin`, `savePin`, `manualActive` and `watchMe` in `public/app.html`.

**D-026: The web app shows how to connect Claude, ChatGPT and Gemini** · 2026-11-15 · Active
- *Decision:* The Home tab's "Ask from your AI" card shows one copyable `/mcp` address and setup steps for Claude (Settings → Connectors → Add custom connector), ChatGPT (Developer mode → Apps & Connectors → Create, no authentication) and Gemini (Settings → Connected Apps → Add a custom app). The dashboard says "Claude, ChatGPT or Gemini" wherever it named only Claude. The server is unchanged: all three use the same open Streamable HTTP endpoint (D-015).
- *Why:* The user wants Oracle presented as working with all three assistants. ChatGPT and Gemini both accept a remote MCP URL, with plan and region limits noted in the card. Not yet tested end to end with ChatGPT or Gemini.
- *Where:* `#home` in `public/app.html`, `public/index.html`.

**D-027: The dashboard names the sponsor at the moment it does the work** · 2026-11-15 · Active
- *Decision:* Small lime tags appear where each sponsor acts: "Gemini" on a checked photo, "TinyFish" when Oracle reads an official page, "Tiger Data" on the 24-hour trend and on instant answers from memory, and "See it on Solana Explorer" on the latest payout. `/app`, `/` and `/join` have a description, a favicon and a link-preview image (`og:image`). No GitHub link: the repo is private.
- *Why:* Sponsor judges look for their own technology; the demo should show it on screen at the moment it is used, not only in a list.
- *Where:* `public/index.html` (`tags`, `photo`, `web`, `showPlace`, `refresh`), `<head>` of `public/app.html`, `public/index.html`, `public/join.html`.

**D-028: The web uses the iPhone app's cream look (replaces the dark + lime theme in D-024)** · 2026-11-15 · Active
- *Decision:* `/app`, `/` and `/join` use the app's Theme.swift look: cream paper with pink dots, charcoal outlines with offset shadows, blue primary buttons, pink/periwinkle/mint tag strips, rounded type, Ora's face as the logo, and a light map. Layouts from D-024 to D-027 are unchanged.
- *Why:* The real iPhone app uses this cream style; the dark preview image in the repo was out of date.
- *Where:* `public/app.html`, `public/index.html`, `public/join.html`.

**D-029: One clean ink stylesheet per page, a shared map look, and app-style map pins** · 2026-11-15 · Active
- *Decision:* Each web page now has one stylesheet instead of three stacked themes (green, dark + lime from D-024, cream from D-028). Shared tokens, map controls and pins live in `public/ink.css`, and the map style lives in `public/ink-map.js`, used by both `/` and `/app`. The map is a cream style with road outlines, street and area names, parks, water and 3D buildings. Place pins copy the iPhone app's PlacePin: a circle in the app's colors (butter for food and coffee, periwinkle for libraries and campus, mint for parks and gyms, pink for everything else) with a charcoal outline and the kind's icon. On the dashboard each pin stands on a short stem. A pin label that would overlap a more important one hides until there is room. Imported places and OpenStreetMap places are smaller and show from closer in. The lime owl is replaced by Ora on the dashboard, the sign-in scene and `/verify`, which now uses the cream look too. Cards use the app's colored header strips, area chips, segmented controls and chunky buttons. `/app` gets zoom and compass buttons. The Home headline matches the app ("What's it like right now?"). Bugs fixed: the bold "near you" map-name layer had an invalid filter and never loaded, and the phone screens in the sign-in scene were hidden by the `.screen` class. No API, data or flow changes.
- *Why:* The user asked for the website to match the app, look neat and clean, and get a better map, without changing functionality.
- *Where:* `public/ink.css`, `public/ink-map.js`, `<style>`, map setup and pin code in `public/index.html` and `public/app.html`, `public/verify.html`.

**D-030: On laptops, the web app is laid out like a website: top navigation and a landing-page Home with live data** · 2026-11-15 · Active
- *Decision:* From 640px wide, `/app` uses a sticky top navigation bar (logo, Home, Requests, Explore, Rewards, Profile) instead of the sidebar, and pages sit in a centered column (max 1180px). Phones keep the bottom tab bar. Home is now a landing page: a hero whose headline rotates through places ("What's it like at the MU / Hayden Library / the gym… right now?"); Ora beside it with cards showing the latest real answers; live totals that count up (`/api/stats`); How it works in three cards; Start where you are and Ask from your AI side by side; a "Just answered" feed (`/api/recent`) where new answers slide in live from `/api/stream`; a scrolling Built with strip; and a footer. Sections rise in as they scroll into view, and cards and buttons respond on hover. With reduced motion turned on, nothing moves. Every existing button, ID and action on Home is kept. The only new requests are reads of public endpoints the dashboard already uses.
- *Why:* The user said the site didn't look clean and neat and asked for it to be organized like other websites, with animation and live content.
- *Where:* `#home` markup, the Home and wide-screen styles, and the "Home: live numbers, live answers, scroll animations" script in `public/app.html`.


**D-031: Home prioritizes two actions, sponsor logos, and an Apple Maps handoff** · 2026-11-15 · Active
- *Decision:* `/app` has a fixed headline, two primary actions (Explore places / Answer & earn), more space between sections, and collapsed location and AI setup cards. A static grid of locally served sponsor marks replaces the text marquee; names remain accessible through alt text and link labels. The approved location-pin mascot replaces the old chest emblem. Visitors can choose Explore first on the sign-in screen to browse public places; answering, rewards, profile and check-in still require sign-in. Place details provide an Open in Apple Maps link with the selected venue's coordinates and name. The embedded map remains MapLibre: MapKit JS needs an Apple Maps token that is not configured here. No paid map service was added.
- *Why:* The user asked for a clearer Home, sponsor logos, and Apple Maps where possible. This removes competing setup content from the first view and provides a working Apple Maps route without breaking the current map.
- *Where:* `public/app.html`, `public/img/ora.png`, `public/img/sponsors/`. Sponsor marks are from Simple Icons (Gemini, MongoDB, Solana, Vultr, GoDaddy, MCP) and official TinyFish/Tiger Data site icons.


**D-032: Public Home is a sectioned website, with channel guides and an explorable place list** · 2026-11-15 · Active
- *Decision:* `/app` starts on Home, including signed-out visitors, rather than forcing the sign-in scene. Protected actions still open sign-in; background public events do not open it for guests. The sign-in scene is replaced by a focused form. Home uses a spacious hero, section dividers, numbered headings, lighter how-it-works columns, separate Telegram/Discord/app guides, setup disclosures, recent answers, and an animated sponsor-logo loop. The loop pauses on hover/focus or via its button, and is static under reduced motion; its duplicate is hidden from accessibility and keyboard navigation. Channel join URLs come from the existing `/api/join` response, with an explicit unavailable state for missing links. iPhone installation and TestFlight availability are explained without inventing a download link. Explore pairs the existing interactive map with a searchable place list and an empty state. Apple Maps opens search queries or exact place coordinates externally. No embedded MapKit JS was added because the user has no Apple Developer account/token; no new paid service is required.
- *Why:* The user requested a real website structure with dividers, animation, detailed channel explanations, and easier exploration. Home must be useful before signing in.
- *Where:* `public/app.html`. Extends D-031; preserves the existing map, API endpoints, accounts, bots, and database behavior.


**D-033: Oracle gets a playful floating navigation dock and branded channel marks** · 2026-11-15 · Active
- *Decision:* Telegram and Discord cards use locally served Simple Icons brand marks in their brand colors. Desktop navigation is a floating white capsule with a grouped tab rail, a tilted active tab, color-coded hover states, a mascot wordmark, and a blue Profile action. The logo is a keyboard-accessible Home button; active tabs expose aria-current. Tablets keep the dock with compact labels, and phones retain the bottom tab bar. Home adds a slow orbit, small sparkles, floating people-powered/fresh-perspectives labels, a speech-bubble entrance, and a one-time headline underline. Existing reduced-motion preferences disable animation. The new accents are decorative and make no fabricated activity claims.
- *Why:* The user requested recognizable channel logos, more Home animation, and a fun, creative product navbar.
- *Where:* `public/app.html`, `public/img/sponsors/telegram.svg`, `public/img/sponsors/discord.svg`. Marks downloaded from the Simple Icons package CDN.

**D-034: Worldwide exploration and calm Requests/Rewards pages ship on a separate branch** · 2026-11-15 · Active
- *Decision:* Explore uses standard 2D OpenStreetMap street tiles instead of the custom tilted map. Visitors explicitly submit worldwide city/venue/address searches through `/api/app/search-places`; results are cached and provider calls share a one-request-per-second limiter with the existing geocoder. Results can be previewed without creating database records or checking in. Oracle's own list follows the visible map area, shows at most 40 rows at a time, and does not imply 599 places are a coverage limit. New search results clearly distinguish missing reports from actual conditions. Requests and Rewards use consistent cream surfaces, clear headers, guest states, location guidance, reward progress and grouped wallet controls. Reward requests and devnet transfers keep their existing backend actions. The user requested branch `feat/web-explore-redesign`, pushed without a merge. Operational deployment steps are in `docs/WEB_DEPLOYMENT.md`; no deployment is performed.
- *Why:* The user found the custom map confusing, wanted exploration beyond saved venues, requested improvements to Requests/Rewards, and asked to review/deploy on a separate branch.
- *Where:* `public/app.html`, `src/web/place-search.js`, `src/web/geo.js`, `src/server.js`, `.env.example`, and `test/`. Existing theme, mascot and channel-logo work is included on the same review branch.

**D-031: iPhone push for TestFlight, and separate Claude and ChatGPT cards that never claim "Connected"** · 2026-11-15 · Active (untested on a device)
- *Decision:* Push: the app registers with APNs on every launch when allowed, and reads its APNs environment from the provisioning profile instead of the build type. It sends the token, the environment and a sound choice to the server, and removes the token on sign-out (new `POST /api/app/apns/remove`). The server adds a badge (open requests for that person), `interruption-level: active`, a 15-minute expiry and the bundled `oracle-chime.caf` (or "default" if the person picked it). On BadDeviceToken it retries the other APNs environment once and remembers it. Settings → Notifications shows the permission and per-setting state and offers Turn on / Open iPhone Settings, a sound choice and a test alert. It never promises to bypass Focus or Silent Mode, and asks for no Time Sensitive or Critical entitlement. AI assistants: the existing swipeable Claude/ChatGPT pages are unchanged. Connect always uses a public MCP address (the app's own server if public, else `https://oracle.tryalethea.com/mcp`), so a local setup no longer shows "Configure server". It copies the address and opens the provider's pre-filled setup link with `universalLinksOnly`: in the provider's app if installed, otherwise the App Store page opens. A web fallback sits in the help section. Neither provider allows silent installation, so the person confirms Add in Claude or ChatGPT. "Connected" is never shown.
- *Why:* The user asked for complete APNs delivery for the TestFlight build. For assistants, they asked to keep the existing pages and have Connect add Oracle in the installed app, or else open the App Store. Sign-out used to keep pushing requests to a signed-out phone, and a Release build run from Xcode picked the wrong APNs server.
- *Where:* `ios/Oracle/Oracle/Notifications.swift`, `ContentView.swift`, `NativeData.swift` (`signOut`), `Settings.swift` (`NotificationSettingsCard`, `AssistantConnection.connect`), `oracle-chime.caf`, `project.pbxproj`, UI tests; `src/channels/apns.js`, `src/channels/app.js`, `src/db/mongo.js`, `src/server.js`.

**D-032: Gift-card redemptions are recorded on Solana devnet, with verified wallets and server-side safeguards** · 2026-11-15 · Active
- *Decision:* Redeem now runs through `src/pay/redemptions.js`.
  - *Points:* the server checks eligibility and takes the points once per redemption ID (an atomic `$inc` guarded by `redeemIds`).
  - *Request key:* each Confirm carries an idempotency key, with a unique index on `{userId, idemKey}`, so double taps and repeated requests make one redemption. Telegram, Discord and the current iPhone build don't send a key, so the server shares one key per reward across taps within 15 seconds.
  - *On chain:* a treasury-signed SPL Memo transaction on devnet that holds only `oracle:redemption:v1:<opaque id>`. There is no new token, and no names, codes or keys go on chain.
  - *Saving the signature:* the signature is saved before sending.
  - *Statuses:* reserved → pending → awaiting_fulfillment (confirmedAt) → fulfilled (operator: `POST /api/redemptions/:id/fulfilled`).
  - *Failures:* a failed or expired transaction becomes `failed` with the points held. Retry sends a new transaction only after the old one can no longer land, and only one at a time. Cancel refunds once (guarded by `refundedIds`).
  - *Restarts:* a reconciler runs at start and every 30 s to finish interrupted work.
  - *Wallets:* ownership is proven by signing a one-time challenge (`/api/app/wallet/challenge` → `/verify`, Ed25519 checked with Node crypto). The Oracle wallet stays the default. Pasting an address is still allowed for cash-out, labeled "not verified".
  - *Web Rewards:* shows per-card progress, a confirmation with the wallet choice, Phantom/Solflare/Backpack connect, and a Pending → Confirmed on devnet → Awaiting fulfillment timeline with the Explorer link, plus Retry and Cancel on failure. Devnet and manual fulfillment are labeled.
- *Why:* "Best Use of Solana": a verifiable on-chain record of each redemption without exposing personal data, and no lost or double-spent points.
- *Where:* `src/pay/redemptions.js`, `src/pay/solana.js` (memo helpers), `src/db/mongo.js`, `src/server.js`, `src/core.js` (`redeemReward` for chat), `public/app.html` (Rewards), `scripts/test-redemptions.js` (19 checks against devnet).

**D-035: The answer cache is off by default (0 minutes)** · 2026-11-15 · Active
- *Decision:* `RULES.cacheMinutes` defaults to 0, and at 0 `ask` skips the memory lookup, so every question goes to people, even when the same topic was answered a minute ago. `CACHE_MINUTES` in `.env` turns it back on. The history and TinyFish fallbacks when nobody answers are unchanged.
- *Why:* The user wants every ask to reach people live (demos and recordings repeat the same question), instead of returning "answered from memory".
- *Where:* `src/config.js`, `src/core.js` (`ask`), server `/opt/oracle/.env`.
