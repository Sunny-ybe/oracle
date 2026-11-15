# 🦉 Oracle

**Eyes on the ground for AI agents.** AI can read the whole internet but can't see the room it's in. Oracle lets any agent ask about a real place ("how long is the food line?", "is there still pizza?") and gets the answer from the people standing there, in under 40 seconds. They earn credits, trust and SOL for it.

## How it works

1. **An agent asks** through MCP (`ask_place`). Gemini turns any free-text question into a request with 3 ordered options and picks how phones should answer it: a one-tap **poll**, a **photo**, a **people count**, a **noise** reading, a **Wi-Fi** speed test, or a **report** (go and find out).
2. **Memory first.** If people answered the same thing at that place in the last 10 minutes, Tiger Data returns it instantly.
3. **People nearby get pinged** on Telegram, Discord, the Oracle web app or the iPhone app: everyone checked in at the place or within 5 miles of it, up to 25 people.
4. **Trust-weighted consensus.** 3 matching votes with combined trust ≥ 2.5 settle it. Every question settles within 40 seconds, so the agent gets its answer in one call.
5. **Measurements beat taps.** A photo is read by Gemini (it counts people, reads the line, and blurs faces, badges, screens and plates before anything is stored). Noise is 10 seconds of microphone, and only the dB number leaves the phone. Wi-Fi is a 1 MB download. One real measurement stands even if nobody else answers. People can also type a number for "how many people" questions.
6. **Few people → photo.** If only 1 or 2 people are nearby, 3 votes can't happen, so Oracle asks for one photo instead. A tap without a photo is reported as unverified and isn't paid.
7. **Disagreement → photo.** After 5 split votes, the most trusted voter gets a link, takes a photo, and Gemini checks it. The page also checks GPS distance, so a photo from across campus is rejected.
8. **Nobody there → the official page, then past reports.** For hours, schedule and menu questions, TinyFish has already read the place's official page in the background, and Gemini answers from those facts, labeled `web`. For everything else Oracle answers at once from the last report at that place, or the same topic at a similar place, or a Gemini estimate. Each is clearly labeled (`past_report`, `similar_place`, `estimate`) and none of them pays.
9. **Everyone who was right** gains trust and gets paid in devnet SOL: 0.001 for a matching tap, 0.01 for a verified photo. Wrong answers lose trust, so liars get quieter over time.
10. **Every answer becomes data** in Tiger Data: trends, busiest hours, and instant future answers.
11. **Spot scans.** In the Oracle app, earners tap *Scan this spot*: a Wi-Fi speed test (a 1 MB file served by Oracle), a 10-second loudness recording, and their floor. Scans per floor become "2nd floor is good, 3rd floor is bad", which agents read with `get_floor_report`.

| Layer | Tech |
|---|---|
| Agent interface | MCP server with 5 tools: `ask_place`, `get_answer`, `get_live_status`, `get_place_insights`, `get_floor_report`. Local for Claude Desktop (`mcp/oracle-mcp.js`) and remote at `/mcp` for claude.ai on web and phone (`mcp/http.js`) |
| People | Telegram bot, Discord bot (buttons + `/checkin` `/ask` `/me` `/leaderboard`), installable web app with push notifications, native iPhone app. What each can do: [`docs/CHANNELS.md`](docs/CHANNELS.md) |
| Brain | Node.js + Express (`src/core.js`) |
| People, places, questions | MongoDB Atlas (2dsphere geo index) |
| Answers, trends, payouts | Tiger Data hypertables + continuous aggregate |
| Questions, photo reading, people counting, face blurring, estimates | Gemini API |
| Official pages (hours, schedules, menus) | TinyFish Agent API, read in the background and stored |
| When nobody answers | The official page for hours-type questions, then past reports in Tiger Data, then a labeled Gemini estimate |
| Payouts | Solana devnet |
| Hosting + domain | Vultr server at `https://oracle.tryalethea.com` (a GoDaddy domain), HTTPS by Caddy. Update it with `npm run deploy` |
| Dashboard | Live map (Leaflet), live vote bars, trend chart, leaderboard, payouts |

## Team

| Person | Owns |
|---|---|
| Harshitha | `src/core.js`, `src/db/`, `mcp/`, Tiger Data, MongoDB |
| Rithwik | `src/channels/discord.js`, `src/channels/telegram.js` |
| Sashikant | `public/` (dashboard + photo page), `src/ai/gemini.js`, `src/pay/solana.js` |

For working on the code (people or AI agents), start at [`AGENTS.md`](AGENTS.md). Decisions and their reasons are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

# Setup (macOS)

## 1. Tools (everyone)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"   # skip if brew works
brew install node git
node --version   # 20 or newer
```

## 2. Code

Harshitha, once:

```bash
cd ~/Desktop && unzip oracle.zip && cd oracle
git init && git add . && git commit -m "Oracle"
# create an empty private repo "oracle" on github.com, then:
git remote add origin https://github.com/<you>/oracle.git
git branch -M main && git push -u origin main
```

Add Rithwik and Sashikant as collaborators. Then everyone:

```bash
git clone https://github.com/<you>/oracle.git && cd oracle   # (Harshitha: already there)
npm install
cp .env.example .env
```

Share one finished `.env` privately. **Never commit it.**

## 3. Accounts and keys (split them up, ~30 min total)

| Key | Who | Steps |
|---|---|---|
| `MONGODB_URI` | Harshitha | mongodb.com/atlas → free M0 cluster → **Database Access**: add a user → **Network Access**: allow `0.0.0.0/0` → **Connect → Drivers** → copy the string, put the password in |
| `TIGER_DATABASE_URL` | Harshitha | tigerdata.com → create a free service → **Connect** → copy the string. Open its **SQL editor**, paste all of `schema.sql`, run |
| `DISCORD_TOKEN` | Rithwik | discord.com/developers → **New Application** "Oracle" → **Bot** → **Reset Token**. Set an owl avatar |
| bot invite | Rithwik | **OAuth2 → URL Generator** → scopes `bot` + `applications.commands` → permissions **View Channels, Send Messages, Read Message History, Embed Links** → open the URL → add to your test server |
| `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID` | Rithwik | Discord **Settings → Advanced → Developer Mode**. Create `#oracle`. Right-click the server icon → Copy Server ID; right-click `#oracle` → Copy Channel ID |
| `TELEGRAM_TOKEN` | Rithwik | In Telegram, message **@BotFather** → `/newbot` → copy the token |
| `GEMINI_API_KEY` | Sashikant | aistudio.google.com → **Get API key** |
| `SOLANA_TREASURY_SECRET` | Sashikant | `npm run wallet` → paste the secret line into `.env` → fund the printed address at faucet.solana.com (Devnet) |
| `TINYFISH_API_KEY` | anyone | agent.tinyfish.ai/api-keys. Optional: without it, official-page answers are off |
| `SESSION_SECRET` | anyone | Any long random string. It signs app sign-ins and **must be the same on every machine** |
| `GEO_BIAS` | anyone | `lat,lng` of your home area (ASU Tempe: `33.4242,-111.9281`). Place lookups prefer it; without it they are worldwide |

Every key is optional except MongoDB and Tiger Data. Missing keys just switch that feature off. `npm run check` validates your `.env` without printing any secrets.

## 4. Run

```bash
npm run dev     # localhost only
npm run demo    # demo day: public HTTPS link + server, and the Mac stays awake
```

Open **http://localhost:3000**. `#oracle` gets the check-in panel; `/checkin`, `/ask`, `/me` and `/leaderboard` appear in Discord. Message your Telegram bot `/start`.

> **Only one machine runs the bots at a time.** Teammates who are coding leave `DISCORD_TOKEN` and `TELEGRAM_TOKEN` empty in their own `.env`.

## 5. Test without phones

```bash
# five fake people at the Student Pavilion
for n in ana ben cal dee eve; do
  curl -s -X POST localhost:3000/api/dev/checkin -H "Content-Type: application/json" \
    -d "{\"name\":\"$n\",\"place\":\"pavilion\"}"; echo
done
```

Ask on the dashboard ("How long is the line?"), then:

```bash
QID=$(curl -s localhost:3000/api/dev/open | node -pe "JSON.parse(require('fs').readFileSync(0))[0].id")
for n in ana ben cal; do
  curl -s -X POST localhost:3000/api/dev/vote -H "Content-Type: application/json" \
    -d "{\"name\":\"$n\",\"questionId\":\"$QID\",\"option\":3}"; echo
done
```

Watch the bars fill and the answer land. Ask again: it answers instantly with the **memory** tag.

To see a **dispute**, vote 1, 2, 3, 1, 2 with five different people. Disputes need a real Discord or Telegram user among the voters to receive the photo link, so check in on your own phone too.

## 6. Test with phones

All three of you tap the same place in `#oracle` (or `/checkin`). Ask from the dashboard or with `/ask` in Discord. Tap on your phones.

If DMs don't arrive: Discord **Settings → Privacy & Safety → allow DMs from server members**. Polls fall back to `#oracle` either way.

## 7. Connect an AI agent (Claude Desktop)

```bash
pwd          # e.g. /Users/harshitha/Desktop/oracle
which node   # e.g. /opt/homebrew/bin/node
open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

(No file? Claude Desktop → **Settings → Developer → Edit Config**.) Paste, with your paths:

```json
{
  "mcpServers": {
    "oracle": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/harshitha/Desktop/oracle/mcp/oracle-mcp.js"],
      "env": { "ORACLE_URL": "http://localhost:3000", "ORACLE_API_KEY": "" }
    }
  }
}
```

Quit Claude Desktop with **Cmd+Q**, reopen it, and try:

- "How long is the line at the Student Pavilion right now?"
- "Is there still pizza at the hackathon?"
- "Which campus spot is least crowded right now?"
- "When is the MU line usually shortest?"

The same server works in Cursor (**Settings → MCP**, same JSON).

### Claude on the web or phone (claude.ai)

Start the server with `npm run demo`; it prints a `Claude MCP` address ending in `/mcp`. In claude.ai: **Settings → Connectors → Add custom connector** and paste that address. No install is needed, and the same five tools appear. While `ORACLE_API_KEY` is empty the endpoint is open to anyone who has the link, so don't post it publicly.

## 8. Go live (Vultr + domain + HTTPS)

HTTPS matters: phones only share location with the photo page over HTTPS.

1. **Vultr:** deploy the cheapest Ubuntu 24.04 instance and copy its IP.
2. **Domain:** register one with GoDaddy Registry and add an **A record** `@` → the IP.
3. On the server:
   ```bash
   ssh root@<IP>
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs git caddy
   git clone https://github.com/<you>/oracle.git && cd oracle && npm install
   nano .env      # paste .env, set PUBLIC_URL=https://<your-domain>
   npx pm2 start src/server.js --name oracle && npx pm2 save
   echo "<your-domain> {
     reverse_proxy localhost:3000
   }" > /etc/caddy/Caddyfile && systemctl restart caddy
   ufw allow 80,443/tcp   # Vultr's firewall only opens SSH by default
   ```
4. Open `https://<your-domain>`. Caddy gets the certificate automatically.
5. Stop the bots on your laptops, and set `ORACLE_URL` in the Claude config to `https://<your-domain>`.

---

# HTTPS for phones (needed for the app, camera, microphone and location)

Phones only allow the camera, microphone and location on https pages. `npm run demo` starts the public link for you and writes it to `PUBLIC_URL`. It uses the first of these that is set in `.env`:

| Setting | Link | Notes |
|---|---|---|
| `TUNNEL_TOKEN` + `PUBLIC_DOMAIN` | Cloudflare named tunnel on your own domain | Fixed address, no notice page. The domain's DNS must be on Cloudflare |
| `NGROK_DOMAIN` | ngrok fixed domain | Fixed address. Browsers see ngrok's notice page once; API clients such as Claude don't |
| neither | Cloudflare quick tunnel | A new address every run, which breaks QR codes and the Claude connector |

# Earners: choose once, answer where you already are

**Questions are only asked in Claude.** Earners never have to open anything else to answer.

**Any place, not a fixed list.** Claude can ask about any store, restaurant, park, parking lot or address ("Trader Joe's on Mill Ave", "the Target on Rural Rd"). Oracle finds it on the map (OpenStreetMap), remembers it, and asks earners whose shared location is within `ANSWER_RADIUS_MILES` (default 5), nearest first. Each request says how far it is ("📍 0.3 mi from you"). The campus places in `src/config.js` are just shortcuts.

The room QR opens `/join` (one general code, not tied to a place), where people pick **once** where requests should reach them, then share their location once:

| Channel | How they answer | Extra sensors |
|---|---|---|
| **Telegram** (fastest) | Tap a button in the chat | Send a photo, type a number for people counts, or send a 10-second voice note for a noise reading |
| **Discord** | Tap a button in the DM | Reply with a photo, a number or a voice message |
| **Oracle web app** | Phone notification → tap → answer | Camera, 10-second microphone meter, 1 MB Wi-Fi speed test, live location, live map |
| **iPhone app** | Native client in `ios/Oracle` | Push needs Apple push keys (`APNS_*`) |

- Every request can be answered with **one tap** everywhere. Photos and readings are optional and earn +5 points.
- Telegram and Discord answer inside the chat. The one exception is a Wi-Fi question: a bot can't measure a connection, so the message adds a personal link that opens the speed test in the browser.
- The full table of what each channel can and can't do is in [`docs/CHANNELS.md`](docs/CHANNELS.md).
- iPhone app users: Share → **Add to Home Screen**, then open Oracle from the Home Screen to allow notifications (iOS 16.4+).
- Voice-note noise readings need ffmpeg on the server: `brew install ffmpeg`.
- The native app pitch (Profile tab): motion, Bluetooth crowd density, light and air pressure, which are sensors a chat bot can't reach.

# Join once, earn everywhere

- **First time:** scan the join QR. Telegram opens, checks you in, and offers to share your location.
- **After that:** no scanning. Share **live location** (📎 → Location → Share My Live Location) and Oracle matches you to the nearest place with a MongoDB geo query. Walk to the MU and you get MU questions.
- **Points:** +1 per answer, +5 for a verified photo or a real measurement. Right answers also earn devnet SOL automatically: 0.001 for a tap, 0.01 for a verified photo.
- **Spend them in Telegram:**
  - `/points`: balance, trust, earnings
  - `/rewards`: gift cards (catalog in `src/config.js` → `REWARDS`). Redemptions are listed at `GET /api/redemptions` for you to fulfil.
  - `/wallet <address>`: link a Phantom wallet (Developer settings → Testnet mode → Devnet)
  - `/cashout <points>`: points → SOL at `POINTS_PER_SOL`, sent on-chain with an explorer link

# Room demo: the judges answer

1. Before judging: `MIN_VOTES=3` in `.env`, server running, dashboard open full screen on the projector.
2. Click **Invite the room** (or press **J**). A big QR appears. Judges scan it and Telegram opens already checked in at `DEMO_PLACE`. Their names pop in and the counter climbs.
3. Click **Start asking** and ask from Claude: *"How long is the food line here right now?"*
4. The map shows one ringing phone per person pinged ("Pinging 6 people"). Judges' phones buzz; each tap lights a phone in its answer's colour and fills the bars.
5. Once 3 agree, Oracle waits `GRACE_SECONDS` (default 8) for the rest of the room, then settles with everyone's votes. Confetti, the answer headline, and Claude answers.
6. Ask again: instant, from memory.

# Demo (3 minutes)

1. **Problem (20 s):** "Ask any AI how long the food line is right now. It can't know."
2. **Join (20 s):** QR to `#oracle`. Judges tap **Student Pavilion**.
3. **Ask (50 s):** in Claude: "How long is the line for food at the hackathon right now?" Phones buzz, the map pulses, bars fill, Claude answers.
4. **Memory (15 s):** ask again. ⚡ Instant. "The first answer costs a tap. The second is free."
5. **Dispute (40 s):** split votes, a photo request, Gemini verifies with a GPS check, the SOL payout appears with its explorer link.
6. **Patterns (20 s):** "When is the line shortest?" Claude answers from Tiger Data.
7. **Close (15 s):** "Oracle turns being somewhere into paid work, and gives every AI agent eyes on the ground."

**Backups:** five teammates' phones checked in, an answer seeded a few minutes before (so step 4 always works), and the demo video.

# Tuning

All the knobs are in `src/config.js`: vote thresholds, timeouts, rewards and places (drop exact map pins before the demo). The ones you're most likely to change are env settings: `MIN_VOTES` (3; set 1 to test alone), `DEADLINE_SECONDS` (40), `CACHE_MINUTES` (10) and `ANSWER_RADIUS_MILES` (5).

# API

| Route | What |
|---|---|
| `POST /api/ask` `{place, question, waitSeconds}` | Ask. Waits up to `waitSeconds` (default 45) and returns `answered`, or `pending` + `question_id` |
| `POST /mcp` | Remote MCP endpoint (Streamable HTTP) for claude.ai and other MCP clients |
| `GET /api/questions/:id` | Result of a pending question |
| `GET /api/status` | Every place: latest answer + people checked in |
| `GET /api/insights?place=&topic=` | Busiest hours + last 24 h |
| `GET /api/stream` | Live events (Server-Sent Events) |
| `GET /verify/:token` | Photo page |
| `/api/dev/*` | Fake people for testing |

## Native iPhone app

The SwiftUI client is in [`ios/Oracle`](ios/Oracle/README.md). Open `ios/Oracle/Oracle.xcodeproj` in Xcode. Home, Explore, Requests, Rewards and Settings use the backend in this repository. See [`NATIVE.md`](NATIVE.md) for the HTTP/MCP integration and the native README for TestFlight preparation. Signing and App Store Connect upload remain separate from this source push.
