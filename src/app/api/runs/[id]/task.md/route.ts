// GET /api/runs/:id/task.md: the finished task file as Markdown.
import { errorReply, fail, limit } from "@/lib/http";
import { isUuid, loadRun } from "@/lib/prism/store";
import { serverDb } from "@/lib/supabase-server";

export async function GET(req: Request, ctx: RouteContext<"/api/runs/[id]/task.md">) {
  try {
    limit(req, "run:read", 600, 600);
    const { id } = await ctx.params;
    if (!isUuid(id)) return fail(404, "Run not found.");
    const run = await loadRun(serverDb(), id);
    if (!run) return fail(404, "Run not found.");
    if (!run.task_md) return fail(409, "This run has no task file yet.");
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(run.task_md, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(download ? { "content-disposition": 'attachment; filename="task.md"' } : {}),
      },
    });
  } catch (e) {
    return errorReply(e);
  }
}
