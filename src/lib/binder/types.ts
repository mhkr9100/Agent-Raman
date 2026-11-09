// Binder contract (FRAMEWORK §3 rule 2, §7; RAMAN-TASK R6): bind(need, constraints) → top pick + alternatives
// + source_method, accepted only on a recorded coverage judgment, never on similarity alone.

export type Executor = "claude_code" | "codex" | "chatgpt" | "cursor";
/** A node's runtime (FRAMEWORK §3 rule 4). `scheduled_host:<name>` is stored as `scheduled_host` in runtime_compat. */
export type Runtime = "executor_session" | `scheduled_host${"" | `:${string}`}` | "human";

/** Retrieval methods (FRAMEWORK §7 rows 1–4, 8, 9) plus propose-and-verify exact matching. */
export type Method =
  | "exact"
  | "keyword"
  | "semantic"
  | "rewrite_keyword"
  | "rewrite_semantic"
  | "ideal_tool"
  | "history"
  | "web_search";

export interface BindConstraints {
  executor?: Executor;
  runtime?: Runtime;
  /** Catalog kinds allowed for this need (e.g. ["model"]); undefined = any. */
  kinds?: string[];
}

export interface NeedInput {
  /** One objective, written as a need (Goal part). Tool names allowed only in proposed_names. */
  need: string;
  /** Names the prism LLM proposed (propose-and-verify): checked by exact match first, never trusted. */
  proposed_names?: string[];
  constraints?: BindConstraints;
}

/** Row from public.binder_cards. */
export interface Card {
  id: string;
  slug: string;
  kind: string;
  name: string;
  description: string | null;
  publisher: string | null;
  official: boolean;
  homepage_url: string | null;
  repo_url: string | null;
  docs_url: string | null;
  categories: string[];
  scope_tags: string[];
  clients_supported: string[];
  runtime_compat: string[];
  install: Record<string, string> | null;
  auth: Record<string, unknown> | null;
  pricing: Record<string, unknown> | null;
  signals: Record<string, Record<string, number>> | null;
  quality: Record<string, unknown> | null;
  licence: string | null;
  tos_notes: string | null;
  verified_on: string | null;
  curated_count: number;
  source_count: number;
  sources: string[];
  co_usage: number;
}

export interface SignalScores {
  usage: number;
  votes: number;
  curation: number;
  co_usage: number;
  quality: number;
}

export interface Candidate {
  card: Card;
  /** Reciprocal Rank Fusion over every retrieval list (k = 50). */
  rrf: number;
  /** Best (lowest) rank this item reached in each method that found it. */
  ranks: Partial<Record<Method, number>>;
  signals: SignalScores;
  /** Final re-ranked score. */
  score: number;
  /** Hard (code) reasons this item cannot be bound under the node's constraints; empty = eligible. */
  ineligible: string[];
}

export interface Judgment {
  verdict: "covers" | "partial" | "none";
  /** Candidate id the LLM says covers the WHOLE need (verdict = covers). */
  primary_id: string | null;
  /** Other candidates that would also cover the whole need, best first. */
  fallback_ids: string[];
  reason: string;
  scope_ok: boolean;
  constraint_conflicts: string[];
  /** One pass/fail check the executor can run once the item is installed. */
  check: string;
  /** When partial: what the candidates leave uncovered (informs the prism's split). */
  uncovered: string[];
}

export interface BindResult {
  /** bound: accepted coverage judgment. partial: candidates cover part → prism should split.
   *  none: nothing grounds → prism emits a "build it" leaf or UNVERIFIED (never drops the need). */
  status: "bound" | "partial" | "none";
  primary: Candidate | null;
  fallbacks: Candidate[];
  /** Top re-ranked candidates shown to the judge (for the coverage appendix and the split). */
  candidates: Candidate[];
  /** Methods that found the primary (`source_method` in the BoM). */
  source_methods: Method[];
  judgment: Judgment | null;
  /** Proposed names that matched nothing in the catalog (rejected per propose-and-verify). */
  unverified_names: string[];
  /** Live web suggestions when the catalog had nothing (method 9); never auto-bound. */
  web_suggestions: { name: string; url: string; why: string }[];
  queries: { rewrites: string[]; keywords: string[]; ideal_tool: string | null };
  timings_ms: Record<string, number>;
}
