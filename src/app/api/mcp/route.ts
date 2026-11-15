// MCP endpoint (Streamable HTTP, stateless, JSON replies). Connect an AI tool with:
//   claude mcp add --transport http agent-raman https://<host>/api/mcp
// No key and no account: the calling tool does the model work, this server answers from the catalog and the gates.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { errorReply, limit } from "@/lib/http";
import { buildServer } from "@/lib/mcp-server";

export const maxDuration = 120;

// No cookies and no credentials are involved, so any origin may call (browser-based MCP clients included).
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "mcp-session-id",
};

const rpcError = (status: number, message: string) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status, headers: { ...CORS, allow: "POST, OPTIONS" } });

export async function POST(req: Request) {
  try {
    limit(req, "mcp", 240, 600);
    if (Number(req.headers.get("content-length") ?? 0) > 400_000) return rpcError(413, "Request too large.");
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = buildServer(req);
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    headers.set("cache-control", "no-store");
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    const r = errorReply(e);
    return r.status === 429 ? rpcError(429, "Too many requests. Try again in a few minutes.") : rpcError(500, "Internal server error.");
  }
}

// Stateless server: there is no event stream to open and no session to end.
export const GET = () => rpcError(405, "Method not allowed. This MCP server answers POST requests only.");
export const DELETE = GET;
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
