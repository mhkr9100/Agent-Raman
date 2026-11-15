// POST /api/runs/:id/decisions: the user's answers to the intake decisions ({ answers: { D1: "…" } }).
// A decision left out keeps its default and is recorded as an assumption.
import { z } from "zod";
import { errorReply, fail, json, limit, readJson } from "@/lib/http";
import { answerDecisions } from "@/lib/prism/engine";
import { isUuid } from "@/lib/prism/store";
import { serverDb } from "@/lib/supabase-server";

const body = z.object({ answers: z.record(z.string().max(20), z.string().max(300)).default({}) });

export async function POST(req: Request, ctx: RouteContext<"/api/runs/[id]/decisions">) {
  try {
    limit(req, "run:decide", 60, 600);
    const { id } = await ctx.params;
    if (!isUuid(id)) return fail(404, "Run not found.");
    const parsed = body.safeParse(await readJson(req, 20_000));
    if (!parsed.success) return fail(400, "Invalid answers.");
    const result = await answerDecisions(serverDb(), id, parsed.data.answers);
    return result ? json(result) : fail(404, "Run not found.");
  } catch (e) {
    return errorReply(e);
  }
}
