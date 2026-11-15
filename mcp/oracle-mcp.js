import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOracleMcp } from "./tools.js";
await createOracleMcp().connect(new StdioServerTransport());
console.error("Oracle MCP ready");
