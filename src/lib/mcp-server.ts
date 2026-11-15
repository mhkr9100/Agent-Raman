// Raman as an MCP server. The calling AI tool is the LLM here: it reads the method (raman_guide), writes the
// plan, and Raman's code answers with catalog facts, gate results and the rendered task file. No user key is
// needed and nothing is stored. Stateless: one server object per HTTP request.
// SDK: @modelcontextprotocol/sdk 1.32.2, Streamable HTTP transport (typings read in node_modules, 2026-11-10).
// Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports (verified_on 2026-11-10).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { limit } from "./http";
import { checkPlan, findCandidates, findSchema, getItems, getSchema, planSchema, renderPlan } from "./prism/agent-api";
import { redact } from "./prism/ask";
import { GUIDE } from "./prism/guide";
import { embedQuery, serverDb } from "./supabase-server";

export const SERVER_INFO = { name: "agent-raman", title: "AgentRamaN", version: "0.1.0" };

const INSTRUCTIONS =
  "AgentRamaN plans a task before any agent runs it. It turns one request into one task.md that lists every capability the task needs " +
  "(MCP servers, skills, plugins, models) bound to real catalog items, with inputs, constraints and checks, and what could not be resolved. " +
  "Use it when the user asks to plan, scope or prepare a task with AgentRamaN. Call raman_guide first and follow it. AgentRamaN never executes the task.";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] });
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

async function guarded(fn: () => Promise<unknown>) {
  try {
    return text(await fn());
  } catch (e) {
    return { ...text(`Error: ${redact(e)}`), isError: true };
  }
}

export function buildServer(req: Request): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool("raman_guide", {
    title: "AgentRamaN method",
    description: "Returns the AgentRamaN planning method and the plan format. Call this first, then follow it step by step.",
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => text(GUIDE));

  server.registerTool("raman_find", {
    title: "Search the capability catalog",
    description: "Finds catalog items (MCP servers, skills, plugins, models) that may cover a need. Up to 5 needs per call. Returns candidates with install lines, the credential names they declare, and why an item cannot be used under the given executor or runtime. A candidate is not coverage: you decide whether it covers the whole need.",
    inputSchema: findSchema.shape,
    annotations: READ_ONLY,
  }, (args) => guarded(async () => {
    limit(req, "mcp:find", 60, 600);
    return findCandidates(serverDb(), embedQuery, args);
  }));

  server.registerTool("raman_get", {
    title: "Read catalog items",
    description: "Returns the full catalog rows for up to 20 ids or slugs from raman_find (longer description, all install lines, sources, licence).",
    inputSchema: getSchema.shape,
    annotations: READ_ONLY,
  }, (args) => guarded(() => getItems(serverDb(), args.ids)));

  server.registerTool("raman_check", {
    title: "Check a plan",
    description: "Runs AgentRamaN's code gates on a plan (format: raman_guide). Verifies every catalog id, refuses items that cannot run where the step runs, and lists untraced criteria, empty categories and steps without a check. Returns problems to fix and warnings. Stores nothing.",
    inputSchema: planSchema.shape,
    annotations: READ_ONLY,
  }, (args) => guarded(() => checkPlan(serverDb(), args)));

  server.registerTool("raman_render", {
    title: "Render task.md",
    description: "Renders the task.md for a plan. Call after raman_check reports no problems; remaining problems are returned and shown inside the file. Give the file to the user unchanged. Stores nothing.",
    inputSchema: planSchema.shape,
    annotations: READ_ONLY,
  }, (args) => guarded(() => renderPlan(serverDb(), args)));

  server.registerPrompt("raman_plan", {
    title: "Plan a task with AgentRamaN",
    description: "Walks the AgentRamaN method for a request and ends with one task.md.",
    argsSchema: { request: z.string().describe("The task to plan, in the user's words") },
  }, ({ request }) => ({
    messages: [{
      role: "user" as const,
      content: { type: "text" as const, text: `${GUIDE}\n\n---\nPlan this request with the method above. Do not execute it.\n\n<request>\n${request}\n</request>` },
    }],
  }));

  return server;
}
