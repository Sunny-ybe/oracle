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

  pointsPerSol: num(process.env.POINTS_PER_SOL, 1000),     // cash-out rate: 1000 points = 1 SOL (devnet)
  minCashout: num(process.env.MIN_CASHOUT, 10),            // smallest cash-out in points
  activeHours: num(process.env.ACTIVE_HOURS, 24),          // check-ins / locations older than this are ignored
  answerRadiusMiles: num(process.env.ANSWER_RADIUS_MILES, 5), // earners this close to a place get its requests (nearest first)
  geoBias: (process.env.GEO_BIAS || "33.4242,-111.9281").split(",").map(Number), // place search prefers results near here (ASU Tempe)

  demoPlace: process.env.DEMO_PLACE || "pavilion",          // where the join QR checks people in
  discordInvite: process.env.DISCORD_INVITE_URL || "",      // optional second QR
};

// How Oracle decides.
export const RULES = {
  minVotes: num(process.env.MIN_VOTES, 3),                                  // at least this many matching votes...
  minWeight: num(process.env.MIN_WEIGHT, num(process.env.MIN_VOTES, 3) - 0.5), // ...whose trust adds up to at least this
  disputeAt: num(process.env.DISPUTE_AT, 5), // this many votes with no consensus -> ask for a photo
  waitSeconds: 60,      // how long an asker waits before getting "pending"
  deadlineSeconds: 90,  // when an unanswered question falls back to the web
  photoMinutes: 5,      // how long a photo link stays valid
  cacheMinutes: 10,     // an answer this fresh is served from memory
  pingCooldownSec: num(process.env.PING_COOLDOWN, 10), // don't ping the same person more often than this
  graceSeconds: num(process.env.GRACE_SECONDS, 8),     // after consensus, wait this long for the rest of the room
  maxPings: num(process.env.MAX_PINGS, 25), // people pinged per question
  trustUp: 0.1, trustDown: 0.2, trustMin: 0.2, trustMax: 2.0,
  startCredits: 3, creditVote: 1, creditPhoto: 5, creditAsk: 1,
};

// Campus places. Coordinates are approximate: drop exact pins from Google Maps before the demo.
// `web` is what TinyFish reads when nobody nearby answers.
export const PLACES = [
  {
    id: "pavilion", name: "Student Pavilion", aliases: ["pavilion", "sunhacks", "hackathon"], kind: "events", tagline: "Events · SunHacks",
    lat: 33.4180, lng: -111.9338, radiusM: 250,
    web: { url: "https://sunhacks.io", goal: "Find the current event schedule (meals, workshops) for today." },
  },
  {
    id: "mu-starbucks", name: "Starbucks (MU)", aliases: ["starbucks", "sbux", "coffee"], kind: "coffee", tagline: "Coffee · Memorial Union",
    lat: 33.4177, lng: -111.9349, radiusM: 120,
    web: { url: "https://asu.campusdish.com", goal: "Find today's hours for Starbucks in the Memorial Union." },
  },
  {
    id: "mu", name: "Memorial Union", aliases: ["mu", "memorial union", "food court"], kind: "food", tagline: "Food · Shops · Hangout",
    lat: 33.4176, lng: -111.9346, radiusM: 250,
    web: { url: "https://asu.campusdish.com", goal: "Find today's hours for dining locations in the Memorial Union." },
  },
  {
    id: "hayden", name: "Hayden Library", aliases: ["hayden", "library"], kind: "library", tagline: "Study · Quiet floors",
    lat: 33.4188, lng: -111.9349, radiusM: 250,
    web: { url: "https://lib.asu.edu/hours", goal: "Find today's opening hours for Hayden Library." },
  },
  {
    id: "sdfc", name: "SDFC Gym", aliases: ["sdfc", "gym", "fitness"], kind: "gym", tagline: "Fitness · Courts · Pool",
    lat: 33.4207, lng: -111.9314, radiusM: 300,
    web: { url: "https://fitness.asu.edu", goal: "Find today's hours for the Sun Devil Fitness Complex in Tempe." },
  },
];

// Gift cards people can spend points on. Fulfilled by hand from GET /api/redemptions.
export const REWARDS = [
  { id: "coffee5", name: "$5 Starbucks gift card", points: 50 },
  { id: "amazon10", name: "$10 Amazon gift card", points: 100 },
  { id: "devils25", name: "$25 Sun Devil Campus Store card", points: 250 },
];

// Ready-made questions. Options always go from lowest (1) to highest (3) so trends make sense.
export const PRESETS = {
  line_length: { question: (p) => `How long is the line at ${p} right now?`, options: ["0-5 min", "5-15 min", "15+ min"] },
  crowd: { question: (p) => `How crowded is ${p} right now?`, options: ["Empty", "Some space", "Packed"] },
  noise: { question: (p) => `How loud is ${p} right now?`, options: ["Quiet", "Chatty", "Loud"], sensor: "noise", thresholds: [55, 70] },
  look: { question: (p) => `What does ${p} look like right now?`, options: ["Calm", "Busy", "Chaotic"], sensor: "photo" },
  ask_staff: { question: (p) => `Can someone at ${p} find out for us?`, options: ["Yes", "Partly", "No"], sensor: "report" },
  people_count: { question: (p) => `How many people are at ${p} right now?`, options: ["Under 15", "15-40", "40+"], sensor: "people_count", thresholds: [15, 40] },
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
