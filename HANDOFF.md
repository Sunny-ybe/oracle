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
- The server already running on :3000 was started before these commits. Restart it to pick them up.

## Priorities (in order)
1. **Permanent free public URL** (D-011). Ask the user whether the team has a domain. Then update `scripts/start.sh` to use `cloudflared tunnel run --token $TUNNEL_TOKEN` when it's set, with `PUBLIC_URL` fixed.
2. **Remote MCP for claude.ai web/phone:** a Streamable HTTP endpoint `/mcp` in Express (`StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`, already installed) exposing the same 5 tools by calling `core.js` directly. Needs #1 for the connector URL.
3. ~~Real Solana payout~~ Done (see Verified). Treasury `B7BNxpGJ79xabJgwxfuxiez113Lutf5f12B5mgDaB7Ks`. Faucet: faucet.solana.com.
4. **Photo path on a real phone** (camera, upload and GPS from a real device). The API path is verified. The dispute photo at `/verify/:token` is still untested.
5. **Judges' phones buzzing:** QR → `/join` → web app. Android Chrome gets push and vibration. iOS needs "Add to Home Screen" and never vibrates, so push that step harder. Telegram is the most reliable buzz.
6. Optional: use floor-scan Wi-Fi data (Mongo `scans`) in the history fallback for Wi-Fi questions.

## Demo video plan
Claude **with vs. without** the Oracle connector (guess vs. real answer), in both Claude Desktop and claude.ai (web/phone), plus judges' phones buzzing with polls.

## Data notes
- App sign-in token is in `localStorage["oracleToken"]`. Accounts, credits, trust and wallets are in Mongo `users`, so clearing the browser loses nothing. Push keys are in Mongo `settings`.
- Question types (Gemini picks one): `poll`, `photo`, `people_count`, `noise`, `report`.
