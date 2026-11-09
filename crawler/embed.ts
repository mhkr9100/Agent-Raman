// Fills capability.embedding with gte-small (384-d). One model, two runtimes:
// - bulk (crawler): Transformers.js `Supabase/gte-small`, ~220 texts/s locally, no CPU cap
// - query time (app): the `embed` Edge Function (≤4 texts/request; 16 hit the 2 s CPU limit → HTTP 546)
// Parity verified 2026-11-08: cosine(local, edge) = 1.00000 on 3 sample texts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMBED_CAP_BYTES, dbBytes } from "./db";

const SELECT_BATCH = 256;
// 64 rows per set_embeddings call hit the 8 s PostgREST statement timeout at ~56k rows (HNSW + GIN upkeep, 2026-11-08).
const WRITE_BATCH = 16;

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

type Pending = { id: string; name: string; description: string | null; kind: string; official: boolean; slug: string; install: Record<string, string> | null; installs: number | null };

/** MCP servers only: remote host, else registry namespace; mirrors public.capability_publisher_key (migration 20261108000005). */
export function publisherKey(kind: string, slug: string, install: Record<string, string> | null): string | null {
  if (kind !== "mcp_server") return null;
  const host = install?.claude_code?.match(/https?:\/\/([^/ ]+)/)?.[1];
  if (host) return host;
  const ns = slug.slice(4).split("/")[0];
  return ns && ns !== "github.com" ? ns : null;
}

/**
 * Rows still to embed, best first: plugins / curated / official, models, MCP servers, then skills by installs.
 * Mass publishers (public.publisher_flag) are skipped. Ranking runs here because one SQL sort over ~84k rows
 * exceeded PostgREST's 8 s timeout on free-tier compute (2026-11-08); id-keyed pages stay fast.
 */
async function rankedPending(db: SupabaseClient): Promise<Pending[]> {
  const [{ data: flags, error: fe }, { data: curated, error: ce }] = await Promise.all([
    db.from("publisher_flag").select("key"),
    db.from("capability_source").select("capability_id").eq("curated", true).limit(100000),
  ]);
  if (fe || ce) throw new Error(`rank inputs: ${(fe ?? ce)!.message}`);
  const flagged = new Set((flags ?? []).map((f) => f.key as string));
  const curatedIds = new Set((curated ?? []).map((c) => c.capability_id as string));

  const rows: Pending[] = [];
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await db
      .from("capability")
      .select("id, name, description, kind, official, slug, install, installs:signals->clawhub->installs")
      .is("embedding", null)
      .in("status", ["active", "provisional"])
      .gt("id", after)
      .order("id")
      .limit(1000);
    if (error) throw new Error(`select pending embeddings: ${error.message}`);
    if (!data?.length) break;
    rows.push(...(data as unknown as Pending[]));
    after = data[data.length - 1].id;
  }
  const tier = (r: Pending) =>
    r.kind === "plugin" || r.official || curatedIds.has(r.id) ? 0 : r.kind === "model" ? 1 : r.kind === "mcp_server" ? 2 : 3;
  return rows
    .filter((r) => { const k = publisherKey(r.kind, r.slug, r.install); return !k || !flagged.has(k); })
    .sort((a, b) => tier(a) - tier(b) || Number(b.installs ?? 0) - Number(a.installs ?? 0) || a.id.localeCompare(b.id));
}

/** Embed up to `max` capabilities without an embedding, best first, until the size cap. Returns how many were embedded. */
export async function embedPending(db: SupabaseClient, max: number, log: (m: string) => void): Promise<number> {
  const queue = (await rankedPending(db)).slice(0, max);
  log(`${queue.length} rows queued for embedding`);
  let done = 0;
  for (let b = 0; b < queue.length; b += SELECT_BATCH) {
    const bytes = await dbBytes(db);
    if (bytes > EMBED_CAP_BYTES) {
      log(`database at ${Math.round(bytes / 2 ** 20)} MB, over the ${EMBED_CAP_BYTES / 2 ** 20} MB embedding cap; stopping`);
      break;
    }
    const data = queue.slice(b, b + SELECT_BATCH);
    const vectors = await embedLocal(data.map((r) => embedText(r.name, r.description)));
    for (let i = 0; i < data.length; i += WRITE_BATCH) {
      const items = data.slice(i, i + WRITE_BATCH).map((r, j) => ({ id: r.id, embedding: vectors[i + j] }));
      let { error: setErr } = await db.rpc("set_embeddings", { p_items: items });
      if (setErr?.message.includes("statement timeout")) ({ error: setErr } = await db.rpc("set_embeddings", { p_items: items }));
      if (setErr) throw new Error(`set_embeddings: ${setErr.message}`);
    }
    done += data.length;
    if (done % 2560 === 0) log(`embedded ${done}`);
  }
  return done;
}
