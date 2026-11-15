// GET /api/runs/:id: what the browser may see of a run (no request text). DELETE removes the run and its tree.
// The run id (a random UUID) is the only handle: whoever holds it can read or delete the run.
import { errorReply, fail, json, limit } from "@/lib/http";
import { deleteRun, isUuid, loadNodes, loadRun, runView } from "@/lib/prism/store";
import { serverDb } from "@/lib/supabase-server";

export async function GET(req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  try {
    limit(req, "run:read", 600, 600);
    const { id } = await ctx.params;
    if (!isUuid(id)) return fail(404, "Run not found.");
    const db = serverDb();
    const run = await loadRun(db, id);
    if (!run) return fail(404, "Run not found.");
    return json(runView(run, await loadNodes(db, id)));
  } catch (e) {
    return errorReply(e);
  }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  try {
    limit(req, "run:delete", 30, 600);
    const { id } = await ctx.params;
    if (!isUuid(id)) return fail(404, "Run not found.");
    const db = serverDb();
    if (!(await loadRun(db, id))) return fail(404, "Run not found.");
    await deleteRun(db, id);
    return json({ deleted: true });
  } catch (e) {
    return errorReply(e);
  }
}
