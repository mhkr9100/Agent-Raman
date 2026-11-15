// Plain HTTP mirror of the MCP tools, for tools that cannot speak MCP:
//   GET  /api/v1/guide            the method (Markdown)
//   POST /api/v1/find|get|check|render   same JSON input and output as the MCP tool of that name
import { errorReply, fail, json, limit, readJson } from "@/lib/http";
import { checkPlan, findCandidates, findSchema, getItems, getSchema, planSchema, renderPlan } from "@/lib/prism/agent-api";
import { GUIDE } from "@/lib/prism/guide";
import { embedQuery, serverDb } from "@/lib/supabase-server";

export const maxDuration = 120;

// Local A/B tests only (evals/ab). With RAMAN_TEST_LOG set to a folder, a call tagged ?run=<label> is logged
// (tool, sizes, time; no bodies) and the last plan and rendered file of that run are saved, so a test agent
// does not retype them. Never set on a public host.
async function testLog(req: Request, tool: string, body: unknown, out: unknown, ms: number): Promise<void> {
  const dir = process.env.RAMAN_TEST_LOG;
  const run = new URL(req.url).searchParams.get("run") ?? "";
  if (!dir || !/^[\w.-]{1,60}$/.test(run)) return;
  const { appendFile, mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  const o = out as { task_md?: string; ok?: boolean; problems?: unknown[]; error?: string };
  const line = { at: new Date().toISOString(), run, tool, ms, in_chars: JSON.stringify(body).length, out_chars: JSON.stringify(out).length, ok: o.ok ?? null, problems: o.problems?.length ?? null, error: o.error ?? null };
  await appendFile(`${dir}/calls.jsonl`, JSON.stringify(line) + "\n");
  if (tool === "check" || tool === "render") await writeFile(`${dir}/${run}.plan.json`, JSON.stringify(body, null, 1));
  if (tool === "render" && typeof o.task_md === "string") await writeFile(`${dir}/${run}.task.md`, o.task_md);
}

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`);

export async function GET(req: Request, ctx: RouteContext<"/api/v1/[tool]">) {
  try {
    limit(req, "v1", 240, 600);
    const { tool } = await ctx.params;
    if (tool !== "guide") return fail(404, "Unknown tool. Use guide (GET) or find, get, check, render (POST).");
    return new Response(GUIDE, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) {
    return errorReply(e);
  }
}

export async function POST(req: Request, ctx: RouteContext<"/api/v1/[tool]">) {
  try {
    limit(req, "v1", 240, 600);
    const { tool } = await ctx.params;
    const body = await readJson(req, 400_000);
    const started = Date.now();
    const reply = async (out: unknown, status = 200) => {
      await testLog(req, tool, body, out, Date.now() - started).catch(() => {});
      return json(out, status);
    };
    const invalid = (what: string, e: Parameters<typeof issues>[0]) => reply({ error: what, issues: issues(e) }, 400);
    const db = serverDb();
    if (tool === "find") {
      limit(req, "mcp:find", 60, 600);
      const p = findSchema.safeParse(body);
      return p.success ? reply(await findCandidates(db, embedQuery, p.data)) : invalid("Invalid input.", p.error);
    }
    if (tool === "get") {
      const p = getSchema.safeParse(body);
      return p.success ? reply(await getItems(db, p.data.ids)) : invalid("Invalid input.", p.error);
    }
    if (tool === "check" || tool === "render") {
      const p = planSchema.safeParse(body);
      if (!p.success) return invalid("Invalid plan.", p.error);
      return reply(tool === "check" ? await checkPlan(db, p.data) : await renderPlan(db, p.data));
    }
    return fail(404, "Unknown tool. Use guide (GET) or find, get, check, render (POST).");
  } catch (e) {
    return errorReply(e);
  }
}
