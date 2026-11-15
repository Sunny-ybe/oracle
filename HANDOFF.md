# Handoff: current status

Written for Harshitha (and any AI agent) picking the project up on 2026-11-15. Start at [`AGENTS.md`](AGENTS.md) for the map and rules. Decisions and their reasons are in [`docs/DECISIONS.md`](docs/DECISIONS.md). This file is only **what's running, what's left, and what not to break**.

## Where Oracle runs now

- **Live server:** `https://oracle.tryalethea.com`, a Vultr instance (`96.30.206.125`), always on (D-021). It runs the Telegram bot `@oracle_sunhacks_bot`. Discord is off.
- **Claude connector:** `https://oracle.tryalethea.com/mcp` (claude.ai → Settings → Connectors → Add custom connector).
- **Web app:** `https://oracle.tryalethea.com/app`. Join page: `/join`. Dashboard: `/`.
- **Nobody's laptop needs to be on.** Sashikant's Mac was the server until the cutover; it now has the bot tokens commented out.

## Three rules that prevent lost votes and broken sign-ins

1. **Never run the bots on your laptop.** Leave `TELEGRAM_TOKEN` and `DISCORD_TOKEN` empty or commented out in your own `.env`. The Vultr server is the only place they run (D-004). Two Telegram bots at once lose votes.
2. **Use the same `SESSION_SECRET` as the server.** Get the `.env` from Sashikant privately. A different secret signs everyone out of the web app (D-009).
3. **The databases are shared and live.** A local server talks to the same MongoDB and Tiger Data. Asking about an ASU place from your laptop pings real people. Test at a faraway place (see Testing).

## Getting started

```bash
git pull
npm install
# put the .env from Sashikant in the repo root, with the two bot tokens commented out
npm run check    # validates .env without printing secrets
npm run dev      # your own copy on http://localhost:3000
```

Your local copy is for development. People and Claude use the Vultr server.

## Deploying to the live server

```bash
npm run deploy   # syntax check, copy the code, install, restart, confirm it answers
```

- Needs SSH access. Send your public key (`cat ~/.ssh/id_ed25519.pub`) to Sashikant; it gets added to `/root/.ssh/authorized_keys` on the server. Then set `ORACLE_SSH_KEY` to your private key path, or name it `~/.ssh/oracle_vultr`.
- The server keeps its own `.env` at `/opt/oracle/.env`; a deploy never touches it. To change a setting there: `ssh root@96.30.206.125`, edit the file, `systemctl restart oracle`.
- **A restart drops any question that is open at that moment.** Don't deploy while someone is recording or demoing. Ask first.
- Logs: `ssh root@96.30.206.125 journalctl -u oracle -f`.

## Testing

- Dev endpoints (no phones): `POST /api/dev/checkin {name, place}`, `POST /api/dev/vote {name, questionId, option}`, `GET /api/dev/open`, `POST /api/ask {place, question, waitSeconds}`.
- Use a faraway place such as `"Merrill-Cazier Library, Utah State University, Logan UT"` and users named `zz-test-…`, and delete the test users, questions and answers afterwards.
- Asking the same topic at the same place within 10 minutes returns the remembered answer and pings nobody. Change the place or topic between tests.

## What works (all tested on 2026-11-15)

- **Poll loop:** tap on Telegram, Discord or the web app; trust-weighted consensus; devnet payout.
- **Photo loop:** Gemini reads or counts the photo, faces blurred, 0.01 SOL. A photo alone answers a plain poll. Few people nearby → photo instead of a poll (D-007).
- **People count:** number ranges; answer by tap, typed number or photo (D-020).
- **Noise** (10 s) and **Wi-Fi** (1 MB speed test) as question types (D-017).
- **Speed:** every question settles within 40 seconds; Claude gets the answer in one call (D-019).
- **Nobody answers:** official page via TinyFish for hours, schedule and menu questions (D-022), then past reports, then a labeled estimate (D-008).
- **Remote MCP** for claude.ai, the web app, and the iPhone app's backend routes.
- What each channel can and can't do: [`docs/CHANNELS.md`](docs/CHANNELS.md).

## Current settings worth knowing

- `MIN_VOTES=1` on the server. One answer settles a question, which suits recording alone. **Set it to 3 on the server before a demo with a room of people** so consensus is real, then `systemctl restart oracle`.
- `ORACLE_API_KEY` is empty, so `/mcp`, `/api/ask` and `/api/dev/*` accept anyone who has the address (D-015). Don't post the address publicly.
- TinyFish only knows the five campus places that have a `web` entry in `PLACES` (`src/config.js`).

## Open problems (as of 2026-11-15, 13:45 UTC)

- **Someone ran a second Telegram bot** between 13:29 and 13:37 UTC: the server logged 16 `Conflict: terminated by other getUpdates request` errors. It was not Sashikant's Mac. While two bots run, taps and photos go to whichever copy grabs them and votes are lost. Check with `ssh root@96.30.206.125 'journalctl -u oracle --since "10 min ago" | grep -c Conflict'`; anything above 0 means a laptop is running the bots (rule 1 above).
- **The claude.ai connector may still point at the old ngrok address**, which now returns 404. It must be `https://oracle.tryalethea.com/mcp`.
- **The iPhone app changes (D-023) compile and launch but nobody has tapped through them.** To build: from `ios/Oracle`, `xcodebuild -project Oracle.xcodeproj -scheme Oracle -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17' build`.

## What's left

1. **Demo video** (Sashikant): Claude with vs. without the Oracle connector, on Claude Desktop and claude.ai, plus Telegram on a phone. The web app part is already recorded (`~/Desktop/oracle-demo/oracle-demo-webapp.mp4` on Sashikant's Mac, made by driving the live web app at iPhone size).
2. **Real-phone checks nobody has done yet:** the web app's Wi-Fi button and number box, the Telegram "Run speed test" link, the dispute photo page `/verify/:token`.
3. **Discord on the server:** add `DISCORD_TOKEN` to `/opt/oracle/.env` and restart, if Discord is wanted for the demo.
4. **iPhone app** (`ios/Oracle`): it now has the Wi-Fi test and typed numbers and defaults to the live server (D-023), but needs a hand test in the Simulator. Push needs Apple push keys (`APNS_*`), which need a paid Apple Developer account. For a real iPhone with a free Apple ID: pick the Personal Team, change the bundle identifier, and remove the push and Sign in with Apple capabilities if signing fails.
5. **Judges' phones:** QR → `/join`. iPhone needs "Add to Home Screen" for web push. Telegram is the most reliable buzz.
6. Optional: use floor-scan Wi-Fi data (Mongo `scans`) in the history fallback.

## Other notes

- The fixed ngrok link (`NGROK_DOMAIN`) belongs to Sashikant's ngrok account and is only used by `npm run demo` on his Mac. It is no longer the public address.
- Test tooling used so far (a fake Telegram server and a regression script) lived outside the repo. If you want it in `scripts/`, ask.
- Leftovers in the shared DB from an early session: questions `c0a480bc` and `3cc23545`, and the place `merrill-cazier-library-fcdb` (used for testing; harmless).
- App sign-in token is in the browser's `localStorage["oracleToken"]`. Accounts, credits, trust and wallets are in Mongo `users`. Push keys and TinyFish page facts are in Mongo `settings`.
