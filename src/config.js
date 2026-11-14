import "dotenv/config";

const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

export const env = {
  port: num(process.env.PORT, 3000),
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${num(process.env.PORT, 3000)}`).replace(/\/$/, ""),
  apiKey: process.env.ORACLE_API_KEY || "",

  mongoUri: process.env.MONGODB_URI,
  mongoDb: process.env.MONGODB_DB || "oracle",
  tigerUrl: process.env.TIGER_DATABASE_URL,

  discordToken: process.env.DISCORD_TOKEN,
  discordGuildId: process.env.DISCORD_GUILD_ID,
  discordChannelId: process.env.DISCORD_CHANNEL_ID,
  telegramToken: process.env.TELEGRAM_TOKEN,

  geminiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  tinyfishKey: process.env.TINYFISH_API_KEY,

  solanaRpc: process.env.SOLANA_RPC || "https://api.devnet.solana.com",
  solanaTreasury: process.env.SOLANA_TREASURY_SECRET,
  rewardVoteSol: num(process.env.REWARD_VOTE_SOL, 0.001), // keep >= 0.001: new wallets need ~0.00089 SOL rent
  rewardPhotoSol: num(process.env.REWARD_PHOTO_SOL, 0.01),
};

// How Oracle decides.
export const RULES = {
  minVotes: 3,          // at least this many matching votes...
  minWeight: 2.5,       // ...whose trust adds up to at least this
  disputeAt: 5,         // this many votes with no consensus -> ask for a photo
  waitSeconds: 60,      // how long an asker waits before getting "pending"
  deadlineSeconds: 90,  // when an unanswered question falls back to the web
  photoMinutes: 5,      // how long a photo link stays valid
  cacheMinutes: 10,     // an answer this fresh is served from memory
  pingCooldownSec: 60,  // don't ping the same person more often than this
  maxPings: 10,         // people pinged per question
  trustUp: 0.1, trustDown: 0.2, trustMin: 0.2, trustMax: 2.0,
  startCredits: 3, creditVote: 1, creditPhoto: 5, creditAsk: 1,
};

// Campus places. Coordinates are approximate: drop exact pins from Google Maps before the demo.
// `web` is what TinyFish reads when nobody nearby answers.
export const PLACES = [
  {
    id: "pavilion", name: "Student Pavilion", aliases: ["pavilion", "sunhacks", "hackathon"],
    lat: 33.4180, lng: -111.9338, radiusM: 250,
    web: { url: "https://sunhacks.io", goal: "Find the current event schedule (meals, workshops) for today." },
  },
  {
    id: "mu", name: "Memorial Union", aliases: ["mu", "memorial union", "food court"],
    lat: 33.4176, lng: -111.9346, radiusM: 250,
    web: { url: "https://asu.campusdish.com", goal: "Find today's hours for dining locations in the Memorial Union." },
  },
  {
    id: "hayden", name: "Hayden Library", aliases: ["hayden", "library"],
    lat: 33.4188, lng: -111.9349, radiusM: 250,
    web: { url: "https://lib.asu.edu/hours", goal: "Find today's opening hours for Hayden Library." },
  },
  {
    id: "sdfc", name: "SDFC Gym", aliases: ["sdfc", "gym", "fitness"],
    lat: 33.4207, lng: -111.9314, radiusM: 300,
    web: { url: "https://fitness.asu.edu", goal: "Find today's hours for the Sun Devil Fitness Complex in Tempe." },
  },
];

// Ready-made questions. Options always go from lowest (1) to highest (3) so trends make sense.
export const PRESETS = {
  line_length: { question: (p) => `How long is the line at ${p} right now?`, options: ["0-5 min", "5-15 min", "15+ min"] },
  crowd: { question: (p) => `How crowded is ${p} right now?`, options: ["Empty", "Some space", "Packed"] },
  noise: { question: (p) => `How loud is ${p} right now?`, options: ["Quiet", "Chatty", "Loud"] },
};

export function findPlace(q) {
  if (!q) return null;
  const s = String(q).toLowerCase().trim();
  return (
    PLACES.find((p) => p.id === s) ||
    PLACES.find((p) => p.name.toLowerCase() === s) ||
    PLACES.find((p) => p.aliases.some((a) => s.includes(a))) ||
    null
  );
}
