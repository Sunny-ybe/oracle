import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createOracleMcp } from './tools.js';
export function mountMcp(app, requireKey) {
  app.post('/mcp', requireKey, async (req, res) => {
    const server = createOracleMcp();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request failed:', error.message);
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
    }
  });
  app.get('/mcp', (_req, res) => res.status(405).end());
  app.delete('/mcp', (_req, res) => res.status(405).end());
}
