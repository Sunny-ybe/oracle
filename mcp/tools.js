// Oracle MCP server: lets any MCP client (Claude Desktop, Cursor, ...) ask the physical world.
// stdout is reserved for MCP messages, so logs go to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PLACES } from "../src/config.js";

const BASE = process.env.ORACLE_URL || `http://localhost:${process.env.PORT || 3000}`;
const headers = { "Content-Type": "application/json", "x-oracle-key": process.env.ORACLE_API_KEY || "" };
const call = async (path, init) => {
  const response = await fetch(`${BASE}${path}`, { headers, ...init, signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Oracle returned ${response.status}`);
  return data;
};

// Text result plus up to 2 privacy-masked photos, so the agent can show what the place looks like.
async function withPhotos(data) {
  const content = [{ type: "text", text: JSON.stringify(data, null, 2) }];
  for (const url of (data.photos || []).slice(0, 2)) {
    try {
      const id = url.split("/").pop();
      const res = await fetch(`${BASE}/api/photos/${id}`);
      if (res.ok) content.push({ type: "image", data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType: "image/jpeg" });
    } catch {}
  }
  return { content };
}


export function createOracleMcp() {
const placeList = PLACES.map((p) => `${p.id} (${p.name})`).join(", ");
const server = new McpServer({ name: "oracle", version: "1.0.0" });

server.tool(
  "ask_place",
  "Ask the physical world. People who are at a place right now answer using their phones: " +
    "one-tap polls (line length, is there food left, free seats), the microphone (how loud it is), " +
    "the camera (how many people, how sunny it is, how bad the dust storm is, is it open, what the parking looks like), " +
    "or by going to find out (ask the staff, check what's in stock). Oracle picks the right sensor automatically. " +
    "Photos come back with faces, name badges, screens and plates blurred; show them to the user when helpful. " +
    "Recent answers return instantly from memory. " +
    "The place can be anything on the map: a store, restaurant, park, parking lot or street address " +
    `(add the street or city if it's ambiguous). Known campus shortcuts: ${placeList}. ` +
    "Earners within a few miles are asked, nearest first. They earn points for answers that match the consensus " +
    "(+1 for a tap, more for a photo or noise reading), which they redeem for gift cards or cash out as Solana devnet SOL, " +
    "and their trust score rises when they're right. " +
    "This call waits for the people on the ground and normally returns the settled answer within about 40 seconds. " +
    "If the result still says \"pending\", call get_answer with the question_id.",
  {
    place: z.string().describe("Any place: a name, store, or address, e.g. 'Trader Joe's on Mill Ave Tempe' or 'MU'"),
    question: z.string().describe("The question in plain English, exactly as the user would ask it"),
  },
  async ({ place, question }) =>
    withPhotos(await call("/api/ask", { method: "POST", body: JSON.stringify({ place, question, waitSeconds: 45 }) }))
);

server.tool(
  "get_answer",
  "Get the result of a question that was still pending, including any privacy-masked photos. Waits up to 25 seconds for people to finish answering.",
  { question_id: z.string() },
  async ({ question_id }) => withPhotos(await call(`/api/questions/${question_id}?wait=25`))
);

server.tool(
  "get_live_status",
  "See every place at once: the latest verified answer for each and how many earners are there right now.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await call("/api/status"), null, 2) }] })
);

server.tool(
  "get_place_insights",
  "Patterns over time for a place: busiest hours this week and the last 24 hours in 15-minute buckets. " +
    "Use for questions like 'when is the MU line shortest?' or 'when is the library quietest?'.",
  {
    place: z.string().describe("Place id or name"),
    topic: z.string().default("line_length").describe("line_length, crowd, noise, people_count, or a topic from known_topics"),
  },
  async ({ place, topic }) => ({
    content: [{ type: "text", text: JSON.stringify(await call(`/api/insights?place=${encodeURIComponent(place)}&topic=${encodeURIComponent(topic)}`), null, 2) }],
  })
);

server.tool(
  "get_floor_report",
  "Which floor of a building is best right now. Earners scan a spot with their phone: a Wi-Fi speed test " +
    "(1 MB download), a 10-second loudness recording, and the floor they're on. Use for questions like " +
    "'which floor of Hayden Library is quietest?', 'where's the best Wi-Fi in the MU?', 'where should I study?'. " +
    "If there are no scans yet, use ask_place to ask people there.",
  { place: z.string().describe("Place id or name, e.g. 'hayden' or 'Hayden Library'") },
  async ({ place }) => ({ content: [{ type: "text", text: JSON.stringify(await call(`/api/floors?place=${encodeURIComponent(place)}`), null, 2) }] })
);


return server;
}
