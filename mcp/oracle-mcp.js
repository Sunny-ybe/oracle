// Oracle MCP server: lets any MCP client (Claude Desktop, Cursor, ...) ask the physical world.
// stdout is reserved for MCP messages, so logs go to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PLACES } from "../src/config.js";

const BASE = process.env.ORACLE_URL || "http://localhost:3000";
const headers = { "Content-Type": "application/json", "x-oracle-key": process.env.ORACLE_API_KEY || "" };
const text = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const call = async (path, init) => (await fetch(`${BASE}${path}`, { headers, ...init })).json();

const placeList = PLACES.map((p) => `${p.id} (${p.name})`).join(", ");
const server = new McpServer({ name: "oracle", version: "1.0.0" });

server.tool(
  "ask_place",
  "Ask people who are physically at a place what is happening there right now: line length, crowd, " +
    "noise, or anything visible (\"is there still pizza?\"). People nearby answer a one-tap poll; " +
    "3 trusted matching answers settle it, disagreements are settled by a verified photo, and if nobody " +
    "is there Oracle reads live web pages. Recent answers return instantly from memory. " +
    `Places: ${placeList}. If the result says "pending", call get_answer with the question_id.`,
  {
    place: z.string().describe("Place id or name"),
    question: z.string().describe("The question in plain English"),
  },
  async ({ place, question }) =>
    text(await call("/api/ask", { method: "POST", body: JSON.stringify({ place, question, waitSeconds: 50 }) }))
);

server.tool(
  "get_answer",
  "Get the result of a question that was still pending.",
  { question_id: z.string() },
  async ({ question_id }) => text(await call(`/api/questions/${question_id}`))
);

server.tool(
  "get_live_status",
  "See every place at once: the latest verified answer for each and how many people are checked in there.",
  {},
  async () => text(await call("/api/status"))
);

server.tool(
  "get_place_insights",
  "Patterns over time for a place: busiest hours this week and the last 24 hours in 15-minute buckets. " +
    "Use this for questions like 'when is the MU line shortest?'.",
  {
    place: z.string().describe("Place id or name"),
    topic: z.string().default("line_length").describe("line_length, crowd, noise, or a custom topic from known_topics"),
  },
  async ({ place, topic }) =>
    text(await call(`/api/insights?place=${encodeURIComponent(place)}&topic=${encodeURIComponent(topic)}`))
);

await server.connect(new StdioServerTransport());
console.error("Oracle MCP ready");
