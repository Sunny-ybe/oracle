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
