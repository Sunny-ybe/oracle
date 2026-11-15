# What each channel can do

How a person answers a request, by channel. "Link" means the bot message carries a personal link that opens the same request in the phone's browser (the Oracle web app, signed in as that person).

| Question type | Oracle web app | Telegram bot | Discord bot |
|---|---|---|---|
| **Poll** (line length, seats, "is there pizza") | Tap | Tap a button | Tap a button |
| **Photo** (what it looks like, is it open) | Tap, or take a photo; Gemini reads it, faces blurred | Tap, or send a photo in the chat | Tap, or reply with a photo in the DM |
| **People count** | Tap, or photograph the room; Gemini counts | Tap, or send a photo | Tap, or reply with a photo |
| **Noise** | Tap, or measure 10 s with the microphone (only the dB number is sent) | Tap, or send a voice note; the server works out the loudness | Tap, or send a voice message |
| **Wi-Fi** | Tap, or run the 1 MB speed test | Tap, or use the link to run the speed test | Tap, or use the link (DM only) |
| **Report** (go and find out) | Type a reply, photo optional | Reply with text, photo optional | Reply with text, photo optional |

| Other ability | Oracle web app | Telegram bot | Discord bot |
|---|---|---|---|
| Knows where you are | Live GPS while the app is open | Share location once, or live location for up to 8 hours | No GPS; `/checkin` a place or `/location` an area |
| Reaches you when closed | Push notification, after "Turn on" (iPhone: Add to Home Screen first) | Always (a normal Telegram message) | Always (a DM) |
| Ask a question | No (asking happens in Claude) | `/ask` | `/ask` |
| Points, rewards, cash-out | Yes | Yes | Yes |
| Floor scan (Wi-Fi + 10 s loudness + floor) | Yes | No | No |
| Dispute photo with GPS check | Yes (`/verify` link) | Opens the link | Opens the link |

Limits that no code change removes:
- A bot cannot run code on the phone, so it cannot measure Wi-Fi speed or read the microphone live. Telegram and Discord get a voice note (noise) or the link (Wi-Fi).
- The speed test measures the phone's current connection to the Oracle server. A browser cannot tell Wi-Fi from mobile data on iPhone.
- Discord has no location sharing, so Discord people are only pinged for the place or area they typed.
- iPhone web push needs the app added to the Home Screen; a Safari tab cannot receive it.

Where: `src/channels/telegram.js`, `src/channels/discord.js`, `src/channels/app.js`, `public/app.html`, `submitReading` in `src/core.js`.
