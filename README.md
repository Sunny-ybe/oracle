# 🦉 Oracle

**Eyes on the ground for AI agents.** AI can read the whole internet but can't see the room it's in. Oracle lets any agent ask about a real place ("how long is the food line?", "is there still pizza?") and gets the answer from the people standing there, in about a minute. They earn credits, trust and SOL for it.

## How it works

1. **An agent asks** through MCP (`ask_place`). Gemini turns any free-text question into a one-tap poll with 3 ordered options.
2. **Memory first.** If people answered the same thing at that place in the last 10 minutes, Tiger Data returns it instantly.
3. **People nearby get pinged** on Discord or Telegram, highest-trust people first.
4. **Trust-weighted consensus.** 3 matching votes with combined trust ≥ 2.5 settle it.
5. **Disagreement → photo.** After 5 split votes, the most trusted voter gets a link, takes a photo, and Gemini checks it. The page also checks GPS distance, so a photo from across campus is rejected.
6. **Nobody there → web.** TinyFish reads the place's live web pages (hours, schedules) and answers, clearly labeled `web`.
7. **Everyone who was right** gains trust and gets paid in devnet SOL. Wrong answers lose trust, so liars get quieter over time.
8. **Every answer becomes data** in Tiger Data: trends, busiest hours, and instant future answers.

| Layer | Tech |
|---|---|
| Agent interface | MCP server (`mcp/oracle-mcp.js`): `ask_place`, `get_answer`, `get_live_status`, `get_place_insights` |
| People | Discord bot (buttons + `/checkin` `/ask` `/me` `/leaderboard`), Telegram bot |
| Brain | Node.js + Express (`src/core.js`) |
| People, places, questions | MongoDB Atlas (2dsphere geo index) |
| Answers, trends, payouts | Tiger Data hypertables + continuous aggregate |
| Questions + photo checks | Gemini API |
| Web fallback | TinyFish Agent API |
| Payouts | Solana devnet |
| Hosting + domain | Vultr + GoDaddy Registry |
| Dashboard | Live map (Leaflet), live vote bars, trend chart, leaderboard, payouts |

## Team

| Person | Owns |
|---|---|
| Harshitha | `src/core.js`, `src/db/`, `mcp/`, Tiger Data, MongoDB |
| Rithwik | `src/channels/discord.js`, `src/channels/telegram.js` |
| Sashikant | `public/` (dashboard + photo page), `src/ai/gemini.js`, `src/pay/solana.js` |

`src/web/tinyfish.js` goes to whoever finishes first.

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
| `TINYFISH_API_KEY` | anyone | agent.tinyfish.ai/api-keys |

Every key is optional except MongoDB and Tiger Data. Missing keys just switch that feature off.

## 4. Run

```bash
npm run dev
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

All the knobs are in `src/config.js`: vote thresholds, timeouts, rewards, places (drop exact map pins before the demo), and the web pages TinyFish reads for each place.

# API

| Route | What |
|---|---|
| `POST /api/ask` `{place, question}` | Ask (returns `answered` or `pending` + `question_id`) |
| `GET /api/questions/:id` | Result of a pending question |
| `GET /api/status` | Every place: latest answer + people checked in |
| `GET /api/insights?place=&topic=` | Busiest hours + last 24 h |
| `GET /api/stream` | Live events (Server-Sent Events) |
| `GET /verify/:token` | Photo page |
| `/api/dev/*` | Fake people for testing |
