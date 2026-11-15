// Prism engine types (FRAMEWORK §2–§6, RAMAN-TASK R7). A run is a tree of nodes; every node carries the same
// seven parts. The LLM writes Goal, Inputs, Instructions, Constraints, Output and Check. Capabilities are written
// only by Binder code (CLAUDE.md), from catalog rows.
import type { Executor } from "../binder/types";

export type Preset = "quick" | "standard" | "deep";

// ⏳ Token budgets and node caps are provisional (not measured against real runs yet; R13 backlog).
export const PRESETS: Record<Preset, { depthCap: number; criticRounds: number; tokenBudget: number; maxNodes: number; twoCuts: boolean; siblings: number }> = {
  quick: { depthCap: 3, criticRounds: 1, tokenBudget: 150_000, maxNodes: 24, twoCuts: false, siblings: 0 },
  standard: { depthCap: 6, criticRounds: 3, tokenBudget: 500_000, maxNodes: 60, twoCuts: true, siblings: 4 },
  deep: { depthCap: 8, criticRounds: 3, tokenBudget: 1_200_000, maxNodes: 120, twoCuts: true, siblings: 8 },
};

/** The 12 categories of the category gate (FRAMEWORK §6). */
export const CATEGORIES = [
  "model_instructions",
  "tools",
  "guardrails",
  "inputs_credentials",
  "output_destination",
  "acceptance_checks",
  "environment_runtime",
  "packaging",
  "telemetry",
  "security",
  "licensing",
  "freshness",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  model_instructions: "Model and instructions",
  tools: "Data, action and orchestration tools",
  guardrails: "Guardrails and human-intervention triggers",
  inputs_credentials: "Inputs and credentials",
  output_destination: "Output format and destination",
  acceptance_checks: "Acceptance checks",
  environment_runtime: "Environment and runtime",
  packaging: "Packaging for the executor",
  telemetry: "Telemetry and report-back",
  security: "Security vetting and secrets",
  licensing: "Licensing and terms of service",
  freshness: "Freshness of sources",
};

export type SpanKind = "goal" | "deliverable" | "constraint" | "cadence" | "system" | "data" | "quality";
export interface Span { id: string; text: string; kind: SpanKind }
export interface Criterion { id: string; text: string; span_ids: string[]; source: "explicit" | "inferred" | "critic" }
export interface Decision {
  id: string;
  question: string;
  options: string[];
  default: string;
  why: string;
  /** Set when the user answers; otherwise the default is used and logged in the Assumptions ledger. */
  answer: string | null;
  source: "llm" | "rule";
}
export interface Assumption { id: string; text: string; source: "default" | "user" | "inferred" | "critic_unverified" | "obstacle"; ref: string | null }

export interface Beam {
  request: string;
  attachments: { name: string; text: string }[];
  summary: string;
  spans: Span[];
  criteria: Criterion[];
  decisions: Decision[];
  environment: { executor: Executor; os: string | null; tools_present: string[]; notes: string[] };
  out_of_scope: string[];
  /** Cadence found by code (regex) or the LLM, e.g. "every 30 minutes". Null = one-off task. */
  cadence: string | null;
}

export type NodeStatus = "pending" | "bound" | "split" | "low_confidence" | "unresolved" | "unverified" | "build" | "human";
export const LEAF_STATUSES: NodeStatus[] = ["bound", "low_confidence", "unresolved", "unverified", "build", "human"];

export type Origin = "request" | "inferred:rule" | "inferred:profile" | "inferred:critic";
export type KindHint = "capability" | "artifact" | "human";
export type SideEffect = "none" | "local_write" | "external_write" | "irreversible";

export interface NodeInput { name: string; type: "decision" | "credential" | "data" | "runtime"; detail: string; env_var: string | null }

/** One Capabilities row. Every field except invoke_when/purpose comes from the catalog row as stored. */
export interface BomRow {
  catalog_id: string;
  slug: string;
  name: string;
  kind: string;
  role: "primary" | "fallback";
  /** The node's need this item was bound for. */
  purpose: string;
  invoke_when: string;
  invoke_how: string | null;
  install: Record<string, string>;
  auth: Record<string, unknown>;
  verify: string;
  cost: string | null;
  licence: string | null;
  provenance: { sources: string[]; curated_count: number; official: boolean; repo_url: string | null; homepage_url: string | null; docs_url: string | null };
  catalog_version: string | null;
  source_methods: string[];
  /** Recorded coverage judgment (binder LLM) or the calling agent's reason (MCP path). */
  judgment: string;
}

export interface PNode {
  id: string;
  run_id: string;
  parent_id: string | null;
  /** Stable outline key: "0" for the root, "1", "1.2", … */
  key: string;
  depth: number;
  status: NodeStatus;
  refinement: "AND" | "OR" | null;
  runtime: string;
  goal: {
    text: string;
    priority: "must" | "should" | "could";
    category: Category;
    kind_hint: KindHint;
    origin: Origin;
    proposed_names: string[];
    depends_on: string[];
    recurring: boolean;
    /** Why this leaf ended as it did (unresolved owner, build reason, force-stop, …). */
    note: string | null;
    owner: string | null;
    attempts: number;
  };
  inputs: NodeInput[];
  instructions: { method: string; persona: string | null; effort: "low" | "medium" | "high" | null };
  capabilities: BomRow[];
  constraints_spec: { items: string[]; budget_tokens: number };
  output: { deliverable: string; contract: string; destination: string; side_effect: SideEffect; rollback: string | null };
  /** `tool_check` is the bind judge's suggested check for the bound item (shown beside the leaf's own check). */
  check_spec: { criterion: string; on_fail: string; enforcement: "command" | "instruction" | "human"; tool_check?: string | null };
  /** Criterion ids, decision ids or `inferred:<source>` tags this node traces up to. */
  trace: string[];
  self_eval: { confidence: number; reason: string; obstacles: { type: string; resolution: string; text: string }[]; gates: Record<string, boolean> } | null;
  tokens_used: number;
  /** Not stored: set when the node changed in this step. */
  dirty?: boolean;
}

export interface GateReport {
  forward: { criterion_id: string; text: string; leaves: string[] }[];
  untraced: string[];
  categories: { category: Category; status: "covered" | "structural" | "not_applicable" | "empty"; by: string[] }[];
  empty_categories: Category[];
  backward_orphans: string[];
  leaf_gate_failures: { key: string; failed: string[] }[];
  contract_issues: string[];
}

export interface CriticProposal {
  missing: string;
  category: Category;
  evidence: "span" | "criterion" | "category" | "catalog_field" | "url_quote" | "none";
  span: string;
  criterion_id: string;
  catalog_slug: string;
  quote: string;
  url: string;
  target_key: string;
  need: string;
  kind_hint: KindHint;
}

export interface RunState {
  critic_rounds: number;
  /** Bound leaves added by each critic round (saturation stop, FRAMEWORK §4). */
  critic_added: number[];
  critic_log: { round: number; framing: string; missing: string; verdict: "accepted" | "ledger"; rule: string }[];
  chapman: { n1: number; n2: number; m: number; estimate: number | null } | null;
  independence: string;
  llm_calls: number;
  events: { t: string; msg: string }[];
  seed: { run_id: string; similarity: number; outline: string[]; items: string[] } | null;
  diff: { previous_run: string; previous_at: string; added: string[]; removed: string[]; kept: number } | null;
  /** Written at finalize: what a later similar run may reuse (re-bound, never trusted). */
  summary: { outline: string[]; items: string[] } | null;
  /** Categories the root split judged not applicable, with the reason. */
  na_categories: { category: Category; why: string }[];
  obstacle_siblings: number;
  /** Merge findings (runtime coherence, contract issues) shown in the task file's open questions. */
  merge_notes: string[];
  /** Consecutive failed steps; the run fails at 3. */
  step_errors: number;
  error: string | null;
}

export const emptyState = (): RunState => ({
  critic_rounds: 0, critic_added: [], critic_log: [], chapman: null, independence: "", llm_calls: 0, events: [], seed: null, diff: null, summary: null,
  na_categories: [], obstacle_siblings: 0, merge_notes: [], step_errors: 0, error: null,
});

export interface Coverage {
  criteria_total: number;
  criteria_traced: number;
  leaves: Record<string, number>;
  categories_covered: number;
  categories_empty: string[];
  inferred_leaves: number;
  chapman: RunState["chapman"];
  bom: number;
}

export interface RunRow {
  id: string;
  created_at: string;
  preset: Preset;
  executor: Executor;
  model: string;
  provider: string | null;
  source: "web" | "mcp" | "eval";
  status: "running" | "done" | "failed" | "cancelled";
  phase: "intake" | "decisions" | "expand" | "obstacles" | "critic" | "finalize" | "done";
  beam: Beam;
  state: RunState;
  assumptions: Assumption[];
  coverage: Coverage | Record<string, never>;
  tokens_in: number;
  tokens_out: number;
  token_budget: number | null;
  task_md: string | null;
  keep_text: boolean;
  request_hash: string;
}
