// Embeds text with gte-small (384-d, English, 512-token truncation) — the ONLY embedding path for
// capability.embedding and run.request_embedding (CLAUDE.md). Docs, verified 2026-11-07:
// https://supabase.com/docs/guides/functions/ai-models
// Request:  POST { "texts": string[] }  (1–4 texts; 16 exceeded the 2 s CPU limit → HTTP 546, 2026-11-08)
// Response: { "model": "gte-small", "dims": 384, "embeddings": number[][] }
// Query-time path only. Bulk catalog embeddings run in the crawler with Transformers.js (same model, cos = 1.0).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MAX_TEXTS = 4;
const MAX_CHARS = 4000; // gte-small truncates at 512 tokens anyway; cap input size

const session = new Supabase.ai.Session("gte-small");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const texts = (body as { texts?: unknown })?.texts;
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_TEXTS ||
      !texts.every((t) => typeof t === "string" && t.trim().length > 0)) {
    return Response.json({ error: `texts must be 1–${MAX_TEXTS} non-empty strings` }, { status: 400 });
  }

  const embeddings: number[][] = [];
  for (const text of texts as string[]) {
    const vector = await session.run(text.slice(0, MAX_CHARS), { mean_pool: true, normalize: true });
    embeddings.push(Array.from(vector as ArrayLike<number>));
  }
  return Response.json({ model: "gte-small", dims: 384, embeddings });
});
