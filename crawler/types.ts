// Shared contract between source adapters and the crawler runner.
// Mirrors public.capability (supabase/migrations/20261108000001_catalog_and_runs.sql).

export type CapabilityKind =
  | "mcp_server" | "skill" | "plugin" | "api" | "model" | "model_as_tool" | "framework" | "package"
  | "dataset" | "space" | "saas" | "prompt_template" | "workflow" | "platform_feature" | "procedure";

export type Client = "claude_code" | "codex" | "chatgpt" | "cursor" | "any";
export type Runtime = "executor_session" | "scheduled_host" | "human";

export interface CapabilityRow {
  /** Canonical, source-agnostic key: `<kind-prefix>:<stable id>`, lowercase. Same item from two sources → same slug. */
  slug: string;
  kind: CapabilityKind;
  name: string;
  description?: string | null;
  publisher?: string | null;
  /** Publisher namespace matches the vendor (e.g. io.github.stripe/* for Stripe). */
  official?: boolean;
  homepage_url?: string | null;
  repo_url?: string | null;
  docs_url?: string | null;
  /** Values from crawler/taxonomy.ts CATEGORIES only. */
  categories?: string[];
  scope_tags?: string[];
  clients_supported?: Client[];
  runtime_compat?: Runtime[];
  /** Keyed by client, e.g. { claude_code: "claude mcp add --transport http x https://…" }. Commands only, never secrets. */
  install?: Record<string, unknown>;
  /** Env var NAMES, scopes, obtain_url — never values. */
  auth?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  /** This source's popularity numbers: stars, installs, downloads, likes, votes, trending… (namespaced per source in the DB). */
  signals?: Record<string, number | string | boolean | null>;
  /** audits, scorecard, advisories, archived, last_commit… */
  quality?: Record<string, unknown>;
  licence?: string | null;
  tos_notes?: string | null;
  status?: "active" | "deprecated" | "deleted" | "provisional";
}

export interface SourceRecord extends CapabilityRow {
  /** Stable id of the item within this source. */
  source_id: string;
  source_url?: string | null;
  /** Untrusted original payload (trimmed). Stored, never followed. */
  raw?: unknown;
}

export interface FetchContext {
  /** Resume point from source_sync.cursor (adapter-defined meaning), or null for a full crawl. */
  cursor: string | null;
  /** Stop after roughly this many records (dry runs, tests). */
  limit?: number;
  log: (msg: string) => void;
}

export interface SourceAdapter {
  /** Matches capability_source.source and source_sync.source, e.g. "mcp_registry". */
  name: string;
  /** Curated list / official marketplace (feeds discovery method 10). */
  curated: boolean;
  /** Doc URL for the endpoint + date verified. */
  docs: { url: string; verified_on: string };
  /**
   * Yields batches of records. May return a new cursor via the `cursor` field of the final yield's context;
   * adapters that support incremental sync set `nextCursor` on the generator's return value.
   */
  fetch(ctx: FetchContext): AsyncGenerator<SourceRecord[], string | null | void>;
}
