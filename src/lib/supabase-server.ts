// Server-only Supabase client. The service role key never reaches the browser (CLAUDE.md: the browser only
// reads through server routes). Every catalog RPC is revoked from anon/authenticated.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function serverDb(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server only)");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** Query-time gte-small embeddings via the `embed` Edge Function (1–4 texts; same model as the catalog). */
export async function embedQuery(texts: string[]): Promise<number[][]> {
  if (texts.length < 1 || texts.length > 4) throw new Error("embedQuery takes 1–4 texts");
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`embed → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { model: string; dims: number; embeddings: number[][] };
  if (body.model !== "gte-small" || body.dims !== 384) throw new Error(`unexpected embedding model ${body.model}/${body.dims}`);
  return body.embeddings;
}
