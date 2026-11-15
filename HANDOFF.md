# Handoff: current status

Start at [`AGENTS.md`](AGENTS.md) for the map and rules. Decisions live in [`docs/DECISIONS.md`](docs/DECISIONS.md). This file is only **what's in flight and what's next**. Update it when status changes.

- **Local folder:** `/Users/sashikantkumar/Desktop/Projects/oracle` (not `~/Desktop/oracle`)
- **Team:** Harshitha (core, DBs, MCP), Rithwik (Discord/Telegram bots), Sashikant / "Sunny" (the user: dashboard, Gemini, Solana)

## Running
- `.env` is complete and verified. **Bot tokens are commented out**, because only one machine runs the bots (D-004). Harshitha's laptop normally does, so coordinate before uncommenting `TELEGRAM_TOKEN` and `DISCORD_TOKEN`.
- Claude Desktop already has the `oracle` MCP server in `~/Library/Application Support/Claude/claude_desktop_config.json` (backup `.json.bak-oracle`). It needs the server on :3000. Tools: `ask_place`, `get_answer`, `get_live_status`, `get_place_insights`, `get_floor_report`.

## Testing
- Dev endpoints (no phones): `POST /api/dev/checkin {name, place}`, `POST /api/dev/vote {name, questionId, option}`, `GET /api/dev/open`, `POST /api/ask {place, question, waitSeconds}`.
- DBs are shared and real teammates are checked in near ASU (5-mile radius), so asking about an ASU place pings real people. Use a faraway place (e.g. "Merrill-Cazier Library, Utah State University, Logan UT") and `zz-test-` users, and delete test users and answers afterwards.

## Verified on 2026-11-15 (test server on :3100, then the test data was deleted)
- D-007 few people → photo: a tap gives "unverified" with no payout; a photo through `/api/app/answer` gives `source: photo`, faces blurred.
- D-008 history fallback: nobody nearby → `similar_place` in about 2 s; after one report → `past_report` in 0 s.
- D-009 `SESSION_SECRET`: tokens are signed with it, and `.env` matches the team Telegram token, so old sign-ins stay valid. **Tell Harshitha:** every machine needs the same value.
- D-013 payouts: **real devnet payouts work end to end** (0.01 for a photo, 0.001 per tap).
- Leftovers from the previous session: questions `c0a480bc` and `3cc23545`, plus the place `merrill-cazier-library-fcdb`, are still in Mongo.

## Priorities (in order)
1. **Add the connector in claude.ai** (user): Settings → Connectors → Add custom connector → `https://swarm-exemplify-verbalize.ngrok-free.dev/mcp`. The endpoint is verified from the public link.
2. **Bots on this Mac.** Harshitha is asleep. Before uncommenting `TELEGRAM_TOKEN` and `DISCORD_TOKEN`, make sure her laptop isn't running them (D-004).
3. **Photo path on a real phone** (camera, upload, GPS). The API path is verified. The dispute photo at `/verify/:token` is still untested.
4. **Optional upgrade to `oracle.tryalethea.com`** (D-014): add the domain to a free Cloudflare account, switch the two nameservers at GoDaddy, run `cloudflared tunnel login`, then create the tunnel and put `TUNNEL_TOKEN` and `PUBLIC_DOMAIN` in `.env`. `start.sh` already supports it.
5. **Judges' phones buzzing:** QR → `/join` → web app. Android Chrome gets push and vibration. iOS needs "Add to Home Screen". Telegram is the most reliable buzz. The native iPhone app needs `APNS_*` keys for push (not set).
6. Optional: use floor-scan Wi-Fi data (Mongo `scans`) in the history fallback for Wi-Fi questions.

## iOS merge check (2026-11-15, commit `7ba0c6b`)
- Pulled as a fast-forward; tag `backup-before-ios-merge` marks the commit before it.
- Regression on a test server passed: history fallback, few-people tap and photo, 0.01 photo payout, 3-tap consensus, GPS check-in, `/mcp` (initialize, list, `ask_place`), new app endpoints and pages. Test data deleted.
- Run the server with `npm run demo`. It serves the fixed public link and prints the MCP address.

## Demo video plan
Claude **with vs. without** the Oracle connector (guess vs. real answer), in both Claude Desktop and claude.ai (web/phone), plus judges' phones buzzing with polls.

## Data notes
- App sign-in token is in `localStorage["oracleToken"]`. Accounts, credits, trust and wallets are in Mongo `users`, so clearing the browser loses nothing. Push keys are in Mongo `settings`.
- Question types (Gemini picks one): `poll`, `photo`, `people_count`, `noise`, `report`.

## Native integration branch (2026-11-15)

- `native-ios` adds the iPhone project under `ios/Oracle` plus its HTTP/MCP, account and optional APNs integration. Upstream SESSION_SECRET, history fallback and photo reward changes are retained.
- Verified before packaging: unsigned iOS device Release build; assistant swipe/setup navigation; sound preference persistence and preview; generated WAV format/clipping checks; Crowd Guess eligibility and positive/insufficient-photo UI paths (positive UI path uses isolated fixtures).
- Native backend `.env` values and Xcode user state are excluded. Shared DB writes and bots are not run by this branch preparation.
- Remaining: stable public HTTPS URL, appropriate API/OAuth authentication for remote assistants, physical-device/APNs validation, and signed TestFlight archive/upload.
