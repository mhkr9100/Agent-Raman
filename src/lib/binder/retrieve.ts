// Retrieval half of the Binder: every method yields one ranked list; lists are fused with RRF (k = 50, as in
// Supabase hybrid search, FRAMEWORK §7). Ranking signals never retrieve on their own (rerank.ts).
import { generateText, Output, type LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Method, NeedInput } from "./types";

export const RRF_K = 50;
const LIST_LIMIT = 40;

export interface Expansion {
  rewrites: string[];
  keywords: string[];
  ideal_tool: string | null;
}

const expansionSchema = z.object({
  rewrites: z.array(z.string()).describe("2 alternative phrasings of the need, as a user would search for a tool"),
  keywords: z.array(z.string()).describe("2-3 short keyword queries (2-4 words each), most specific first"),
  ideal_tool: z.string().describe("One-paragraph description of the ideal catalog item (MCP server, skill, plugin, API or model) that would fully cover this need, written like its README summary"),
});

/** Methods 3 (query rewriting, ToolReAGt) and 4 (imagine the ideal tool, ToolDreamer) in ONE structured call. */
export async function expandNeed(model: LanguageModel, input: NeedInput): Promise<Expansion> {
  const { output } = await generateText({
    model,
    temperature: 0,
    output: Output.object({ schema: expansionSchema }),
    system:
      "You help a catalog search engine find AI-agent capabilities (MCP servers, skills, plugins, APIs, models). " +
      "Rewrite the need for search. Do not invent product names; describe functions. Output only the schema.",
    prompt: `Need: ${input.need}${input.constraints?.kinds ? `\nAllowed kinds: ${input.constraints.kinds.join(", ")}` : ""}`,
  });
  return {
    rewrites: output.rewrites.slice(0, 2),
    keywords: output.keywords.slice(0, 3),
    ideal_tool: output.ideal_tool || null,
  };
}

type RankedList = { method: Method; ids: { id: string; rank: number }[]; failed?: string };

// One search leg. A leg that fails twice (on the free tier: a statement timeout under concurrent calls, seen
// 2026-11-10) returns an empty list instead of failing the whole need; the other legs still rank the catalog.
async function rpcRows<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<{ rows: T[]; failed?: string }> {
  let message = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400));
    const { data, error } = await db.rpc(fn, args);
    if (!error) return { rows: (data ?? []) as T[] };
    message = `${fn}: ${error.message}`;
  }
  return { rows: [], failed: message };
}

async function rpcList(db: SupabaseClient, method: Method, fn: string, args: Record<string, unknown>): Promise<RankedList> {
  const { rows, failed } = await rpcRows<{ id: string; rank: number }>(db, fn, args);
  return { method, ids: rows.map((r) => ({ id: r.id, rank: r.rank })), failed };
}

export interface RetrievalResult {
  fused: { id: string; rrf: number; ranks: Partial<Record<Method, number>> }[];
  exact: { id: string; proposed: string; how: string }[];
  unverified_names: string[];
  expansion: Expansion;
  /** Search legs that failed twice and were left out of the ranking. */
  degraded: string[];
}

/**
 * Runs exact match (propose-and-verify), keyword, semantic, query rewrites, ideal-tool and history, then fuses.
 * `embed` takes 1–4 texts. Without a model, methods 3–4 are skipped (retrieval-only evals).
 */
export async function retrieve(
  db: SupabaseClient,
  input: NeedInput,
  embed: (texts: string[]) => Promise<number[][]>,
  model: LanguageModel | null,
  timings: Record<string, number>,
): Promise<RetrievalResult> {
  const kinds = input.constraints?.kinds ?? null;
  const t0 = Date.now();
  const expansion: Expansion = model ? await expandNeed(model, input) : { rewrites: [], keywords: [], ideal_tool: null };
  timings.expand = Date.now() - t0;

  const t1 = Date.now();
  const texts = [input.need, ...expansion.rewrites, ...(expansion.ideal_tool ? [expansion.ideal_tool] : [])].slice(0, 4);
  const vectors = await embed(texts);
  timings.embed = Date.now() - t1;
  const vec = (i: number) => JSON.stringify(vectors[i]);
  const idealIndex = expansion.ideal_tool ? texts.length - 1 : -1;

  const t2 = Date.now();
  const names = (input.proposed_names ?? []).map((n) => n.trim()).filter(Boolean);
  const jobs: Promise<RankedList>[] = [
    rpcList(db, "keyword", "binder_keyword", { p_query: input.need, p_kinds: kinds, p_limit: LIST_LIMIT, p_any: false }),
    rpcList(db, "semantic", "binder_semantic", { p_embedding: vec(0), p_kinds: kinds, p_limit: LIST_LIMIT }),
    rpcList(db, "history", "binder_history", { p_embedding: vec(0), p_runs: 5, p_limit: LIST_LIMIT }),
    ...expansion.keywords.map((k) =>
      rpcList(db, "rewrite_keyword", "binder_keyword", { p_query: k, p_kinds: kinds, p_limit: LIST_LIMIT, p_any: false }),
    ),
    ...expansion.rewrites.map((_, i) =>
      rpcList(db, "rewrite_semantic", "binder_semantic", { p_embedding: vec(i + 1), p_kinds: kinds, p_limit: LIST_LIMIT }),
    ),
    ...(idealIndex > 0
      ? [rpcList(db, "ideal_tool", "binder_semantic", { p_embedding: vec(idealIndex), p_kinds: kinds, p_limit: LIST_LIMIT })]
      : []),
  ];
  const exactJob = names.length
    ? rpcRows<{ id: string; rank: number; proposed: string; how: string }>(db, "binder_exact", { p_names: names, p_limit: 20 })
    : Promise.resolve({ rows: [] as { id: string; rank: number; proposed: string; how: string }[], failed: undefined as string | undefined });
  const [lists, exactReply] = await Promise.all([Promise.all(jobs), exactJob]);
  const exact = exactReply.rows;
  const degraded = [...lists.map((l) => l.failed), exactReply.failed].filter((f): f is string => !!f);
  // The need's own semantic and keyword legs are the floor: with both gone there is nothing to rank.
  if (lists[0].failed && lists[1].failed) throw new Error(degraded[0]);
  // A failed exact match must not read as "this name is not in the catalog".
  if (exactReply.failed) throw new Error(exactReply.failed);
  if (degraded.length) console.warn("binder: search legs left out:", degraded.join(" | "));

  // Keyword search uses AND semantics. An OR fallback (p_any) was measured at 3.3 s for a long need on the free
  // tier and timed out under concurrent calls (2026-11-09), so recall for long needs comes from the short
  // LLM keyword queries and semantic search instead.
  if (exact.length) lists.push({ method: "exact", ids: exact.map((e) => ({ id: e.id, rank: e.rank })) });
  timings.retrieve = Date.now() - t2;

  const fused = new Map<string, { id: string; rrf: number; ranks: Partial<Record<Method, number>> }>();
  for (const list of lists) {
    for (const { id, rank } of list.ids) {
      const f = fused.get(id) ?? { id, rrf: 0, ranks: {} };
      f.rrf += 1 / (RRF_K + rank);
      f.ranks[list.method] = Math.min(f.ranks[list.method] ?? Infinity, rank);
      fused.set(id, f);
    }
  }
  const matched = new Set(exact.map((e) => e.proposed.toLowerCase()));
  return {
    fused: [...fused.values()].sort((a, b) => b.rrf - a.rrf),
    exact: exact.map(({ id, proposed, how }) => ({ id, proposed, how })),
    unverified_names: names.filter((n) => !matched.has(n.toLowerCase())),
    expansion,
    degraded,
  };
}
