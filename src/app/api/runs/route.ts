// POST /api/runs: create a run. No model call happens here; the browser then drives POST /api/runs/:id/step.
import { z } from "zod";
import { errorReply, fail, json, limit, modelLabels, readJson } from "@/lib/http";
import { EXECUTORS } from "@/lib/prism/agent-api";
import { createRun, LIMITS } from "@/lib/prism/engine";
import { serverDb } from "@/lib/supabase-server";

const body = z.object({
  request: z.string().min(1).max(LIMITS.request),
  executor: z.enum(EXECUTORS),
  preset: z.enum(["quick", "standard", "deep"]).default("standard"),
  attachments: z.array(z.object({ name: z.string().min(1).max(200), text: z.string().max(LIMITS.attachment) })).max(LIMITS.attachments).optional(),
  keep_text: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    limit(req, "run:create", 12, 3600);
    const { provider, model } = modelLabels(req); // labels only; the key is not needed to create a run
    const parsed = body.safeParse(await readJson(req, 400_000));
    if (!parsed.success) return fail(400, "Invalid request.", { issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
    const made = await createRun(serverDb(), { ...parsed.data, model, provider, source: "web" });
    return json(made, 201);
  } catch (e) {
    return errorReply(e);
  }
}
