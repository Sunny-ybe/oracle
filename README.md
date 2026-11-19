<p align="center">
  <img src="public/img/ora.png" alt="Ora, Oracle’s smiling green mascot with a location-pin badge" width="180" />
</p>

<h1 align="center">Oracle</h1>

<p align="center"><strong>AI agents can read the whole internet, but they can’t see the physical world.<br/>Oracle gives them eyes: real people nearby answer live questions about real places.</strong></p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-Express-339933?logo=nodedotjs&logoColor=white">
  <img alt="SwiftUI" src="https://img.shields.io/badge/iOS-SwiftUI-0D96F6?logo=swift&logoColor=white">
  <img alt="MCP" src="https://img.shields.io/badge/AI-MCP%20server-111111">
  <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white">
  <img alt="Gemini" src="https://img.shields.io/badge/Gemini-8E75B2?logo=googlegemini&logoColor=white">
  <img alt="Solana" src="https://img.shields.io/badge/Solana-devnet-9945FF?logo=solana&logoColor=white">
</p>

<p align="center">
  <a href="#run-it-locally">Run it locally</a> ·
  <a href="#connect-an-ai-assistant">Connect an AI assistant</a> ·
  <a href="ios/Oracle/README.md">iPhone app</a>
</p>

> Ask Claude or ChatGPT *“how long is the coffee line right now?”* and it has no idea. With Oracle connected, the question goes to people who are actually there, and the agent gets back a verified answer in under a minute.

## At a glance

| | |
| --- | --- |
| **What** | An MCP server that lets any AI agent ask questions about the physical world, answered by nearby people over Telegram, Discord, the web, or a native iPhone app |
| **Built at** | SunHacks (ASU), team of 3 |
| **My role** | Most of the commits (31 of 48): core backend (question matching, voting, answer resolution), the MCP server, Telegram/Discord/push channels, the Gemini pipeline, and the architecture docs |
| **Shipped** | Backend deployed on Vultr during the hackathon, iPhone app on TestFlight (SwiftUI, ~5k lines), 4 answer channels, Solana devnet rewards |
| **Hard parts** | Matching questions to people by location in real time, settling disagreements with trust scores and photo checks, blurring faces before photos are stored, and labeling every fallback so a guess never passes as a fresh answer |

## Why we built it

An AI agent can find a café’s opening hours. It usually can’t tell you how long the line is right now. Someone already there can.

Oracle connects those two sides. An agent asks about a place, people nearby answer, and useful answers earn points. ASU is our starting point for testing, but Oracle is built for cafés, libraries, airports, parks, and other real places.

## What Oracle does

- **Ask about a place.** AI assistants use Oracle’s MCP tools to send questions and read answers.
- **Answer nearby questions.** People can respond through Telegram, Discord, the website, or the native iPhone app.
- **Share more than a guess.** Responses can include polls, photos, people counts, noise readings, and connection-speed tests.
- **Compare reports.** Oracle uses agreement, trust scores, photo checks, and location checks to help assess answers.
- **Reuse recent answers.** Fresh reports can answer another question without asking everyone again.
- **Explore places.** The website has a street map, worldwide place search, and Oracle reports where people have contributed.
- **Earn rewards.** People collect points, request gift cards, and try Solana devnet payouts.

Finding a place does not mean Oracle has a live report from it. The app shows when a report is missing instead of treating missing information as an answer.

## How it works

1. **An agent asks a question.** For example: “How long is the coffee line at this café?”
2. **Oracle checks recent reports.** If a suitable answer is still fresh, it returns that answer first.
3. **People nearby receive the request.** Oracle matches the place with people who have checked in or shared their location.
4. **They answer.** Depending on the question, they can tap an option, send a photo, type a reply, or take a measurement.
5. **Oracle compares the responses.** Matching answers and trust scores help settle the question. Disagreements can lead to a photo check.
6. **The agent gets the result.** Oracle returns the answer with its source and supporting details, then saves the report for later use.

When nobody can answer, Oracle can use an official webpage, an older report, a similar place, or an AI estimate. These sources are labeled so they are not confused with a fresh answer from someone there. Fallback answers do not earn responder payouts.

The default request deadline is 40 seconds. An answer may still be unverified or based on a fallback; a fast response is not a guarantee that someone nearby confirmed it.

## Choose how to participate

| Channel | What you can do |
| --- | --- |
| **Telegram** | Receive questions in chat. Answer with buttons, text, photos, or voice notes. Share your location to receive nearby requests. |
| **Discord** | Check in with `/checkin` or set an area with `/location`. Receive requests in DMs and answer with buttons or messages. |
| **Website** | Browse the map, answer requests, run spot scans, and manage rewards. Web notifications need permission and browser support. |
| **iPhone app** | Use the native SwiftUI app for Home, Explore, Requests, Rewards, and Settings. Remote notifications need APNs setup on the backend. |

Bots link to the website for connection-speed tests because they cannot run those tests inside a chat. A browser test measures the current connection to the Oracle server; it cannot always tell Wi-Fi from mobile data.

See [channel details](docs/CHANNELS.md) for the differences between each option.

## Points, gift cards, and Solana

Points are managed by Oracle’s backend. They are not a new cryptocurrency.

When a person has enough points, they can request a gift card. The backend checks the balance, deducts points, and records an anonymous redemption ID in a Solana devnet memo transaction. The website shows the transaction status and a Solana Explorer link.

The redemption flow includes duplicate-request checks, wallet ownership verification, retries, and cancellation for eligible failed requests. The website supports a signed wallet challenge; choosing an address alone does not prove ownership.

**Gift cards are fulfilled manually.** A confirmed blockchain transaction records the request—it does not buy or deliver the gift card. Solana payouts in this project use **devnet**, and devnet SOL has no monetary value.

Reward thresholds and payout amounts are configured in [src/config.js](src/config.js).

## Photos and location

Oracle’s photo pipeline blurs detected faces and personal details before storing photos. Detection can miss things, so people should avoid photographing private information in the first place.

Location helps Oracle send relevant requests and check supporting evidence. Browsing a distant venue does not check someone in there. When GPS is wrong, the app provides a way to correct the location on the map.

## What we used

| Part | Technology |
| --- | --- |
| Backend and HTTP API | Node.js and Express |
| AI assistant tools | Model Context Protocol (MCP) |
| Accounts, places, and requests | MongoDB |
| Report history, trends, and payouts | Tiger Data |
| Question planning and photo interpretation | Gemini |
| Official-page fallback | TinyFish |
| Chat channels | Telegram and Discord |
| Native iPhone app | SwiftUI |
| Web maps and worldwide search | MapLibre, OpenStreetMap, and Nominatim |
| Test payouts and redemption records | Solana devnet |
| Existing hosted backend | Vultr |

Features depend on the credentials and services configured on the server. Code in this repository does not mean every integration is enabled or verified on every deployment.

## Run it locally

You need Node.js 22 or newer, npm, and access to MongoDB and Tiger Data.

```bash
git clone https://github.com/Sunny-ybe/oracle.git
cd oracle
npm ci

# Create a local environment file if you do not already have one.
test -f .env || cp .env.example .env
```

Fill in `.env` using [.env.example](.env.example) as the reference. Do not commit this file.

| Setting | Purpose |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DB` | MongoDB connection and database name |
| `TIGER_DATABASE_URL` | Tiger Data connection; initialize its tables using [schema.sql](schema.sql) |
| `SESSION_SECRET` | Signs account sessions. Keep it stable for servers that share those sessions. |
| `PUBLIC_URL` | The backend’s public HTTPS address; use the local address while developing |
| `ORACLE_API_KEY` | Optional key for agent and operator routes. If empty, those routes do not require a key. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini features |
| `TINYFISH_API_KEY` | Official-page fallback |
| `SOLANA_RPC`, `SOLANA_TREASURY_SECRET` | Solana devnet connection and treasury |
| `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` | Native iPhone push notifications |
| `DISCORD_INVITE_URL` | Public Discord join link |
| `GEO_BIAS` | Optional preferred area for agent place lookups; leave empty for no preferred area |
| `AUTO_IMPORT_PLACES=0` | Disables automatic place imports during local or preview startup |

Other settings, including bot credentials, OAuth clients, and reward rules, are listed in `.env.example` and `src/config.js`.

**Keep `TELEGRAM_TOKEN` and `DISCORD_TOKEN` unset on development laptops.** The team’s bots run on the existing Vultr server. Running another copy can interfere with request delivery.

Check the configuration and start the server:

```bash
npm run check
npm run dev
```

Then open:

- **Website:** [http://localhost:3000/app](http://localhost:3000/app)
- **Dashboard:** [http://localhost:3000](http://localhost:3000)
- **Join page:** [http://localhost:3000/join](http://localhost:3000/join)

A physical phone needs a reachable backend address. `localhost` on a phone refers to the phone itself. Use a public HTTPS address for phone testing and browser access to the camera, microphone, and location.

For a temporary public link, `npm run demo` starts the server and a configured tunnel. See [deployment instructions](docs/WEB_DEPLOYMENT.md) before setting up a separate preview or changing the live server.

## Connect an AI assistant

The team's hosted server is offline for now, so connect an assistant to your own deployment. Its remote MCP endpoint is `<PUBLIC_URL>/mcp`; check `/api/app/config` to see the exact address and whether it needs a key. Setting `ORACLE_API_KEY` turns on key protection.

Add Oracle as a custom MCP connector in an assistant that supports remote MCP servers. Setup and availability depend on the assistant and account. The iPhone app includes Claude and ChatGPT setup guidance; it does not silently install a connector or claim a connection it cannot verify.

For a local client that supports stdio MCP servers, use a configuration like this with your own Node and repository paths:

```json
{
  "mcpServers": {
    "oracle": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/oracle/mcp/oracle-mcp.js"],
      "env": {
        "ORACLE_URL": "http://localhost:3000",
        "ORACLE_API_KEY": ""
      }
    }
  }
}
```

Oracle exposes five tools: `ask_place`, `get_answer`, `get_live_status`, `get_place_insights`, and `get_floor_report`.

Try asking:

- “How long is the coffee line at this venue right now?”
- “Which floor of this library is quietest?”
- “Is there still food at the event?”

Include a city or address when the place name could refer to more than one venue.

## Work on the iPhone app

Open `ios/Oracle/Oracle.xcodeproj` in Xcode. The app uses the backend in this repository.

See the [iPhone README](ios/Oracle/README.md) for server settings, signing, TestFlight preparation, and push notifications. [NATIVE.md](NATIVE.md) describes the native API integration.

Push notifications require an Apple-enabled build, server APNs credentials, a registered device token, and the user’s permission. Alerts and sounds follow the person’s iOS notification settings, Focus, and Silent Mode. Keep Apple keys on the server, not in the app or Git.

## Check your changes

Run the local tests without sending payouts or creating database users:

```bash
node --test test/*.test.js
```

The separate `scripts/test-redemptions.js` script is an integration test. It creates a temporary user and sends devnet transactions. Use it only with a deliberately configured test environment.

The team’s databases contain real users. Use separate preview databases where possible. For shared-database tests, follow [AGENTS.md](AGENTS.md) and the testing instructions in [HANDOFF.md](HANDOFF.md): use `zz-test-` users at a faraway location and clean up afterward.

## Code guide

| Location | What is there |
| --- | --- |
| [src/core.js](src/core.js) | Questions, matching, voting, and answer resolution |
| [src/db/](src/db/) | MongoDB and Tiger Data access |
| [src/ai/](src/ai/) | Question planning, photo checks, privacy masking, and audio helpers |
| [src/channels/](src/channels/) | Telegram, Discord, web push, and APNs |
| [src/pay/](src/pay/) | Solana payouts and gift-card redemption records |
| [mcp/](mcp/) | Local and remote MCP servers |
| [public/](public/) | Website, dashboard, and shared assets |
| [ios/Oracle/](ios/Oracle/) | Native iPhone app |

Start with [AGENTS.md](AGENTS.md) before changing the code. The project’s decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Team

Built by Harshitha, Rithwik, and Sashikant for SunHacks.
