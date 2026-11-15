// POST /api/runs/:id/step: one unit of work (intake, one node batch, obstacles, one critic round, or finalize).
// The browser calls it until the run stops. The user's key is read from the headers of THIS request only.
import { errorReply, fail, json, limit, modelFromHeaders } from "@/lib/http";
import { safeFetchPage } from "@/lib/prism/critic";
import { step } from "@/lib/prism/engine";
import { isUuid } from "@/lib/prism/store";
import { embedQuery, serverDb } from "@/lib/supabase-server";

// One step is a handful of model calls plus catalog searches. https://vercel.com/docs/functions/limitations
// (default and Hobby maximum 300 s with Fluid Compute, verified_on 2026-11-09).
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/runs/[id]/step">) {
  try {
    limit(req, "run:step", 400, 3600);
    const { id } = await ctx.params;
    if (!isUuid(id)) return fail(404, "Run not found.");
    const { model } = await modelFromHeaders(req);
    const result = await step({ db: serverDb(), embed: embedQuery, model, fetchPage: safeFetchPage }, id);
    return result ? json(result) : fail(404, "Run not found.");
  } catch (e) {
    return errorReply(e);
  }
}
