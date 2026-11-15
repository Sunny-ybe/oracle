# AGENTS.md — start here

Oracle: AI agents ask about real places, nearby people answer (tap/photo), trust-weighted consensus settles it, the people who were right get paid devnet SOL, and every answer is remembered. Hackathon project (SunHacks @ ASU).

**Read only what the task needs.** This file is the map. Follow the pointers below instead of reading whole files.

## Rules (always)
1. **Never print, log or commit `.env` values.** `.env.example` lists the keys.
2. **After every change, tell the user what changed and why** (files plus a one-line reason each).
3. **Every architecture or product decision goes in [`docs/DECISIONS.md`](docs/DECISIONS.md)** as a new numbered entry. No decisions anywhere else. Don't re-ask anything recorded there.
4. **Commit only when the user says so.** Branch `main`, remote `github.com/Sunny-ybe/oracle`.
5. **Shared databases.** Mongo and Tiger are the team's live DBs, and real people are checked in near ASU. Test at a faraway place with `zz-test-` users, then delete them. Details: [`HANDOFF.md` § Testing](HANDOFF.md#testing).
6. **Free tiers only.** Nothing may cost money.

## Where to look
| Need | Go to |
|---|---|
| Current status, open work, priorities | [`HANDOFF.md`](HANDOFF.md) |
| Why something is the way it is | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| What Telegram, Discord and the web app can each do | [`docs/CHANNELS.md`](docs/CHANNELS.md) |
| Product pitch, setup, API list, demo script | [`README.md`](README.md) (long, so read by section: `grep -n '^#' README.md`) |
| Thresholds (votes, deadlines, trust, credits) | `RULES` in `src/config.js` |
| Env keys | `env` in `src/config.js`, `.env.example` |
| SQL schema (Tiger) | `schema.sql` |

## Run
`npm run demo` starts the public link (fixed domain, see D-014) and the server, and rewrites `PUBLIC_URL` (`scripts/start.sh`). Plain `npm run dev` runs localhost:3000 only. To test without phones, use the `/api/dev/*` endpoints in `src/server.js`.

## Code map (one line per file; open only the one you need)
**Server and brain**
- `src/server.js`: Express routes only. All logic lives in `core.js`. Search it with `grep -n "app\.\(get\|post\)" src/server.js`.
- `src/core.js` (~800 lines, the heart): `ask` → `recordVote` → consensus/dispute → `finalize` → pay and remember. History fallback in `answerFromHistory`. Open questions live **in memory** (`live` Map). Grep for function names; don't read it top to bottom.
- `src/config.js`: `env`, `RULES`, campus `PLACES`, `REWARDS`, `PRESETS`.
- `src/scan.js`: floor scans (Wi-Fi + loudness + floor proof).

**Data**
- `src/db/mongo.js`: users, places, questions, photos, push keys, settings.
- `src/db/tiger.js`: answers, trends, payouts (Timescale time series).

**AI and sensing**
- `src/ai/gemini.js`: question planning, photo checking/reading, summaries, floor signs, `estimateAnswer`. Uses model fallbacks.
- `src/ai/privacy.js`: face/PII masking. `src/ai/audio.js`: loudness in dB.

**Channels** (they register with `core.registerChannel`)
- `src/channels/telegram.js`, `src/channels/discord.js`, `src/channels/app.js` (web push).

**Web helpers**
- `src/web/auth.js`: app sign-in tokens (`SESSION_SECRET`). `src/web/accounts.js`: register, login, OAuth.
- `src/web/geo.js`: geocoding. `src/web/places-import.js`: bulk places. `src/web/tinyfish.js`: **unused** (see D-008).

**Other**
- `src/pay/solana.js`: devnet payouts.
- `mcp/tools.js`: the 5 MCP tools (they call the HTTP API). `mcp/oracle-mcp.js`: stdio entry for Claude Desktop. `mcp/http.js`: remote `/mcp` endpoint for claude.ai.
- `src/web/native.js`, `src/web/game.js`, `src/channels/apns.js`: iPhone app support (nearby places, Crowd Guess game, Apple Push).
- `ios/Oracle/`: native iPhone app (Swift). Has its own `README.md`. Not needed to run the server.
- `scripts/check-env.js`: `npm run check` validates `.env` without printing secrets.
- `public/`: `index.html` (dashboard), `app.html` (earner PWA), `join.html` (QR landing), `verify.html` (dispute photo), `sw.js` (push).
- `scripts/start.sh`: demo launcher. `scripts/make-wallet.js`: new Solana treasury.
