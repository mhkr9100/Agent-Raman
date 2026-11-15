// Capabilities rows are built here, in code, from catalog rows as stored (CLAUDE.md: the LLM never writes
// Capabilities parts). The only LLM text carried along is the recorded coverage judgment, marked as such.
import type { Candidate, Card, Executor } from "../binder/types";
import { clip, envName } from "./text";
import type { BomRow, NodeInput } from "./types";

/** Env-var and header NAMES a catalog row declares. Values never exist in the catalog. */
export function authSpec(auth: Record<string, unknown> | null | undefined): { env: string[]; headers: string[] } {
  const names = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name : ""))
          .filter(Boolean)
      : [];
  if (!auth) return { env: [], headers: [] };
  return {
    env: [...new Set([...names(auth.env), ...names(auth.env_vars)])].slice(0, 8),
    headers: [...new Set(names(auth.headers))].slice(0, 4),
  };
}

/** Adds the credentials a catalog row declares to a step's inputs (names only, never values). */
export function addCredentialInputs(inputs: NodeInput[], card: Card): void {
  const spec = authSpec(card.auth);
  for (const raw of spec.env) {
    const name = envName(raw);
    if (name && !inputs.some((i) => i.env_var === name)) inputs.push({ name, type: "credential", detail: `Declared by ${card.name} in the catalog`, env_var: name });
  }
  for (const h of spec.headers) {
    if (!inputs.some((i) => i.name === `Header ${h}`)) inputs.push({ name: `Header ${h}`, type: "credential", detail: `HTTP header ${card.name} declares in the catalog; keep its value out of files`, env_var: null });
  }
}

function cost(card: Card): string | null {
  const p = card.pricing;
  if (!p || !Object.keys(p).length) return null;
  if (typeof p.input === "number" || typeof p.output === "number") {
    return `input ${p.input ?? "?"} / output ${p.output ?? "?"} USD ${typeof p.unit === "string" ? p.unit : "per 1M tokens"} (catalog value, check the provider)`;
  }
  return clip(JSON.stringify(p), 160);
}

const HOW: Record<string, string> = {
  mcp_server: "After install its tools are available in the session; call them by name.",
  skill: "After install, invoke the skill by name.",
  plugin: "After install its commands and tools are available in the session.",
  model: "Call this model id through its provider's API.",
  model_as_tool: "Call this model id through its provider's API as a tool.",
};

const VERIFY: Record<string, string> = {
  mcp_server: "The executor lists its connected MCP servers and this one appears with at least one tool.",
  skill: "The skill appears in the executor's list of available skills.",
  plugin: "The plugin is listed as installed and enabled.",
  model: "A minimal test call to this model id succeeds.",
  model_as_tool: "A minimal test call to this model id succeeds.",
};

export function bomRow(
  c: Candidate,
  role: BomRow["role"],
  node: { key: string; goal: string },
  judgment: string,
  source_methods: string[],
): BomRow {
  const k = c.card;
  return {
    catalog_id: k.id,
    slug: k.slug,
    name: k.name,
    kind: k.kind,
    role,
    purpose: node.goal,
    invoke_when: role === "primary" ? `In step ${node.key}: ${clip(node.goal, 160)}` : `Only if the primary for step ${node.key} cannot be installed or fails its check`,
    invoke_how: HOW[k.kind] ?? null,
    install: k.install ?? {},
    auth: k.auth ?? {},
    verify: VERIFY[k.kind] ?? "The item is installed and answers one test request.",
    cost: cost(k),
    licence: k.licence,
    provenance: {
      sources: k.sources,
      curated_count: k.curated_count,
      official: k.official,
      repo_url: k.repo_url,
      homepage_url: k.homepage_url,
      docs_url: k.docs_url,
    },
    catalog_version: k.verified_on,
    source_methods,
    judgment,
  };
}

/** The install line for the chosen executor, else any one the catalog has. Catalog text: review before running. */
export function installFor(row: BomRow, executor: Executor): { client: string; command: string } | null {
  const i = row.install ?? {};
  if (typeof i[executor] === "string" && i[executor]) return { client: executor, command: i[executor] };
  const first = Object.entries(i).find(([, v]) => typeof v === "string" && v);
  return first ? { client: first[0], command: first[1] } : null;
}
