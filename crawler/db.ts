// Crawler write path: service role only (RLS has no policies; see migrations).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SourceRecord } from "./types";

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Rows per upsert_capabilities call. Adapters yield up to 200; 200-row calls hit PostgREST's 8 s timeout on
// free-tier compute in the first Actions run (2026-11-09), so the write path splits them.
const UPSERT_CHUNK = 100;

/** Upsert one batch through public.upsert_capabilities (merge rules live in SQL). */
export async function upsertBatch(db: SupabaseClient, source: string, curated: boolean, rows: SourceRecord[]) {
  // Raw payloads cost ~84 MB per 75k rows (measured 2026-11-08) against the 500 MB free tier; store them only on request.
  const keepRaw = process.env.CRAWL_KEEP_RAW === "1";
  const payload = keepRaw ? rows : rows.map(({ raw: _raw, ...r }) => r);
  let written = 0;
  for (let i = 0; i < payload.length; i += UPSERT_CHUNK) {
    const { data, error } = await db.rpc("upsert_capabilities", { p_source: source, p_curated: curated, p_rows: payload.slice(i, i + UPSERT_CHUNK) });
    if (error) throw new Error(`upsert_capabilities(${source}): ${error.message}`);
    written += data as number;
  }
  return written;
}

export async function readCursor(db: SupabaseClient, source: string): Promise<string | null> {
  const { data, error } = await db.from("source_sync").select("cursor").eq("source", source).maybeSingle();
  if (error) throw new Error(`source_sync read: ${error.message}`);
  return data?.cursor ?? null;
}

export async function writeSync(
  db: SupabaseClient,
  source: string,
  fields: { cursor?: string | null; last_status: "ok" | "partial" | "failed"; rows_upserted: number; error?: string | null },
) {
  const { error } = await db
    .from("source_sync")
    .upsert({ source, last_run_at: new Date().toISOString(), ...fields }, { onConflict: "source" });
  if (error) throw new Error(`source_sync write: ${error.message}`);
}

// Supabase free tier caps the database at 500 MB (https://supabase.com/pricing, verified 2026-11-08).
// Writes stop below that so the project never goes read-only; embeddings stop earlier to leave room for row growth.
export const WRITE_CAP_BYTES = 470 * 1024 * 1024;
export const EMBED_CAP_BYTES = 440 * 1024 * 1024;

export async function dbBytes(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc("catalog_db_bytes");
  if (error) throw new Error(`catalog_db_bytes: ${error.message}`);
  return Number(data);
}
