// bind(need, constraints) → top pick + alternatives + source_method (RAMAN-TASK R6).
// Order: propose-and-verify exact match → discovery ensemble (retrieve.ts) → RRF → signal re-rank → code
// eligibility → recorded LLM coverage judgment → web fallback only when nothing grounds.
// The LLM never writes capability rows or Capabilities parts; this module returns catalog rows as found.
import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { judgeCoverage } from "./accept";
import { DEFAULT_WEIGHTS, rerank, type Weights } from "./rerank";
import { retrieve } from "./retrieve";
import type { BindResult, Candidate, Card, Method, NeedInput } from "./types";
import type { WebSearch } from "./web";

export type { BindResult, Candidate, NeedInput } from "./types";

export interface BindOptions {
  db: SupabaseClient;
  embed: (texts: string[]) => Promise<number[][]>;
  /** User's model for query expansion and the coverage judgment. Null = retrieval only (no bind is accepted). */
  model: LanguageModel | null;
  webSearch?: WebSearch | null;
  weights?: Weights;
  /** Candidates shown to the judge. */
  judgeTopK?: number;
}

const CARD_POOL = 60;

async function loadCards(db: SupabaseClient, ids: string[]): Promise<Map<string, Card>> {
  if (!ids.length) return new Map();
  const { data, error } = await db.rpc("binder_cards", { p_ids: ids });
  if (error) throw new Error(`binder_cards: ${error.message}`);
  return new Map(((data ?? []) as Card[]).map((c) => [c.id, c]));
}

const methodsOf = (c: Candidate) => (Object.keys(c.ranks) as Method[]).sort((a, b) => (c.ranks[a] ?? 99) - (c.ranks[b] ?? 99));

export async function bind(input: NeedInput, opts: BindOptions): Promise<BindResult> {
  const timings: Record<string, number> = {};
  const r = await retrieve(opts.db, input, opts.embed, opts.model, timings);

  const t0 = Date.now();
  const exactIds = new Set(r.exact.map((e) => e.id));
  const poolIds = [...new Set([...r.exact.map((e) => e.id), ...r.fused.slice(0, CARD_POOL).map((f) => f.id)])];
  const cards = await loadCards(opts.db, poolIds);
  const ranked = rerank(r.fused.filter((f) => cards.has(f.id)), cards, input.constraints, opts.weights ?? DEFAULT_WEIGHTS);
  timings.rerank = Date.now() - t0;

  // Exact matches of proposed names are always shown to the judge (propose-and-verify), then the best eligible.
  const k = opts.judgeTopK ?? 8;
  const eligible = ranked.filter((c) => c.ineligible.length === 0);
  const shown = [...eligible.filter((c) => exactIds.has(c.card.id)), ...eligible.filter((c) => !exactIds.has(c.card.id))].slice(0, k);

  const base: BindResult = {
    status: "none",
    primary: null,
    fallbacks: [],
    candidates: shown.length ? shown : ranked.slice(0, k),
    source_methods: [],
    judgment: null,
    unverified_names: r.unverified_names,
    web_suggestions: [],
    queries: { rewrites: r.expansion.rewrites, keywords: r.expansion.keywords, ideal_tool: r.expansion.ideal_tool },
    timings_ms: timings,
  };

  // No model → retrieval only. Similarity alone never binds (FRAMEWORK §3 rule 2).
  if (!opts.model) return { ...base, status: shown.length ? "partial" : "none" };

  if (shown.length) {
    const t1 = Date.now();
    const j = await judgeCoverage(opts.model, input, shown);
    timings.judge = Date.now() - t1;
    const byId = new Map(shown.map((c) => [c.card.id, c]));
    const primary = j.primary_id ? byId.get(j.primary_id) ?? null : null;
    const accepted = j.verdict === "covers" && !!primary && j.scope_ok && j.constraint_conflicts.length === 0;
    if (accepted) {
      return {
        ...base,
        status: "bound",
        primary,
        fallbacks: j.fallback_ids.map((id) => byId.get(id)).filter((c): c is Candidate => !!c).slice(0, 3),
        source_methods: methodsOf(primary!),
        judgment: j,
      };
    }
    if (j.verdict !== "none") return { ...base, status: "partial", judgment: j };
    base.judgment = j;
  }

  // Nothing grounds: live web suggestions for an UNVERIFIED leaf (never bound).
  if (opts.webSearch) {
    const t2 = Date.now();
    base.web_suggestions = await opts.webSearch(input.need).catch(() => []);
    timings.web = Date.now() - t2;
  }
  return base;
}
