// Fills capability.embedding with gte-small (384-d). One model, two runtimes:
// - bulk (crawler): Transformers.js `Supabase/gte-small`, ~220 texts/s locally, no CPU cap
// - query time (app): the `embed` Edge Function (≤4 texts/request; 16 hit the 2 s CPU limit → HTTP 546)
// Parity verified 2026-11-08: cosine(local, edge) = 1.00000 on 3 sample texts.
import type { SupabaseClient } from "@supabase/supabase-js";

const SELECT_BATCH = 256;
const WRITE_BATCH = 64;

export function embedText(name: string, description: string | null): string {
  return description ? `${name}. ${description}` : name;
}

type Extractor = (text: string, opts: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array }>;
let extractor: Extractor | null = null;

/** Bulk embeddings, same model as the Edge Function. */
export async function embedLocal(texts: string[]): Promise<number[][]> {
  if (!extractor) {
    const { pipeline } = await import("@huggingface/transformers");
    extractor = (await pipeline("feature-extraction", "Supabase/gte-small")) as unknown as Extractor;
  }
  const out: number[][] = [];
  for (const t of texts) out.push(Array.from((await extractor(t.slice(0, 4000), { pooling: "mean", normalize: true })).data));
  return out;
}

/** Query-time embeddings through the Edge Function (≤4 texts). */
export async function embedEdge(texts: string[]): Promise<number[][]> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`embed → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { model: string; dims: number; embeddings: number[][] };
  if (body.model !== "gte-small" || body.dims !== 384) throw new Error(`unexpected embedding model ${body.model}/${body.dims}`);
  return body.embeddings;
}

/** Embed up to `max` capabilities that have no embedding yet. Returns how many were embedded. */
export async function embedPending(db: SupabaseClient, max: number, log: (m: string) => void): Promise<number> {
  let done = 0;
  while (done < max) {
    const { data, error } = await db
      .from("capability")
      .select("id, name, description")
      .is("embedding", null)
      .in("status", ["active", "provisional"])
      .limit(Math.min(SELECT_BATCH, max - done));
    if (error) throw new Error(`select pending embeddings: ${error.message}`);
    if (!data?.length) break;

    const vectors = await embedLocal(data.map((r) => embedText(r.name, r.description)));
    for (let i = 0; i < data.length; i += WRITE_BATCH) {
      const items = data.slice(i, i + WRITE_BATCH).map((r, j) => ({ id: r.id, embedding: vectors[i + j] }));
      const { error: setErr } = await db.rpc("set_embeddings", { p_items: items });
      if (setErr) throw new Error(`set_embeddings: ${setErr.message}`);
    }
    done += data.length;
    if (done % 2560 === 0) log(`embedded ${done}`);
  }
  return done;
}
