// POST /api/runs/:id/feedback: a rating, a note, and optionally the executor's raman_report.json.
import { z } from "zod";
import { errorReply, fail, json, limit, readJson } from "@/lib/http";
import { isUuid, loadRun, saveRun } from "@/lib/prism/store";
import { scrubSecrets } from "@/lib/prism/text";
import { serverDb } from "@/lib/supabase-server";

const body = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  feedback: z.string().max(2000).optional(),
  report_back: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/runs/[id]/feedback">) {
  try {
    limit(req, "run:feedback", 30, 3600);
    const { id } = await ctx.params;
    if (!isUuid(id)) return fail(404, "Run not found.");
    const parsed = body.safeParse(await readJson(req, 60_000));
    if (!parsed.success) return fail(400, "Invalid feedback.");
    const db = serverDb();
    const run = await loadRun(db, id);
    if (!run) return fail(404, "Run not found.");
    if (run.status === "running") return fail(409, "The run is not finished.");
    const patch: Record<string, unknown> = {};
    if (parsed.data.rating !== undefined) patch.rating = parsed.data.rating;
    if (parsed.data.feedback !== undefined) patch.feedback = scrubSecrets(parsed.data.feedback).text;
    if (parsed.data.report_back !== undefined) {
      // Stored as data for later evaluation; never fed back to a model as instructions.
      const text = scrubSecrets(JSON.stringify(parsed.data.report_back)).text;
      if (text.length > 50_000) return fail(413, "The report is too large.");
      patch.report_back = JSON.parse(text);
    }
    if (!Object.keys(patch).length) return fail(400, "Nothing to save.");
    await saveRun(db, id, patch);
    return json({ saved: true });
  } catch (e) {
    return errorReply(e);
  }
}
