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

type RankedList = { method: Method; ids: { id: string; rank: number }[] };

async function rpcList(db: SupabaseClient, method: Method, fn: string, args: Record<string, unknown>): Promise<RankedList> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return { method, ids: ((data ?? []) as { id: string; rank: number }[]).map((r) => ({ id: r.id, rank: r.rank })) };
}

export interface RetrievalResult {
  fused: { id: string; rrf: number; ranks: Partial<Record<Method, number>> }[];
  exact: { id: string; proposed: string; how: string }[];
  unverified_names: string[];
  expansion: Expansion;
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
    ? db.rpc("binder_exact", { p_names: names, p_limit: 20 }).then(({ data, error }) => {
        if (error) throw new Error(`binder_exact: ${error.message}`);
        return (data ?? []) as { id: string; rank: number; proposed: string; how: string }[];
      })
    : Promise.resolve([]);
  const [lists, exact] = await Promise.all([Promise.all(jobs), exactJob]);

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
  };
}
