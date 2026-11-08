// Official MCP Registry adapter.
// Endpoint: GET https://registry.modelcontextprotocol.io/v0.1/servers?limit=100&version=latest[&cursor=…][&updated_since=…]
//   - openapi: https://registry.modelcontextprotocol.io/openapi.yaml (verified_on 2026-11-08)
//     limit max 100; version=latest → one record per server name; include_deleted is forced true when updated_since is set;
//     follow metadata.nextCursor with the same filters.
//   - aggregator guide: https://modelcontextprotocol.io/registry/registry-aggregators (verified_on 2026-11-08)
//     unauthenticated, poll "regular but infrequent (e.g. once per hour)", no durability guarantees; keep status in sync.
// Crawled text (descriptions, header/env descriptions) is untrusted data: stored, never followed.
import { fetchJson, trimRaw } from "../http";
import { githubPath, mcpSlug } from "../slug";
import { categorize } from "../taxonomy";
import type { Client, SourceAdapter, SourceRecord } from "../types";
import { SECRET_LIKE } from "../secrets";

const BASE = "https://registry.modelcontextprotocol.io";
const PAGE = 100; // openapi maximum
const MIN_INTERVAL_MS = 300; // ~600 requests for a full crawl; well within "about hourly" polling etiquette
const OFFICIAL_META = "io.modelcontextprotocol.registry/official";

interface KeyValueInput {
  name?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  value?: string;
  default?: string;
}
interface Argument extends KeyValueInput {
  type?: "positional" | "named";
}
interface Package {
  registryType?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  transport?: { type?: string; url?: string };
  runtimeArguments?: Argument[];
  packageArguments?: Argument[];
  environmentVariables?: KeyValueInput[];
}
interface Remote {
  type?: string;
  url?: string;
  headers?: KeyValueInput[];
  variables?: Record<string, unknown>;
}
interface ServerJson {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string; source?: string; subfolder?: string; id?: string };
  remotes?: Remote[];
  packages?: Package[];
}
interface OfficialMeta {
  status?: "active" | "deprecated" | "deleted";
  publishedAt?: string;
  updatedAt?: string;
  statusChangedAt?: string;
  isLatest?: boolean;
}
interface Entry {
  server: ServerJson;
  _meta?: Record<string, unknown>;
}
interface ListResponse {
  servers?: Entry[];
  metadata?: { nextCursor?: string; count?: number };
}

const ALL_CLIENTS: Client[] = ["claude_code", "codex", "chatgpt", "cursor"];
const LOCAL_CLIENTS: Client[] = ["claude_code", "codex", "cursor"]; // ChatGPT only connects to remote servers

const lastSegment = (name: string) => name.split("/").pop() ?? name;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/mcp|server|official/g, "");
const sameName = (a: string | undefined, b: string) =>
  !!a && (a.toLowerCase() === b.toLowerCase() || (norm(a).length >= 2 && norm(a) === norm(b)));

/**
 * Canonical slug. The registry lets many distinct servers point at one repo (one repo is claimed by 2,000+ server
 * names; the template repo modelcontextprotocol/registry by several), so the repo path is only used when the repo
 * (or subfolder) leaf matches the server's own name or title. Otherwise the registry name is the stable id.
 */
function slugFor(s: ServerJson): string {
  const repoUrl = s.repository?.url;
  const sub = s.repository?.subfolder;
  const path = githubPath(repoUrl, sub);
  if (path) {
    const leaf = path.split("/").pop()!;
    if (sameName(lastSegment(s.name), leaf) || sameName(s.title, leaf)) return mcpSlug(repoUrl, sub, s.name);
  }
  return mcpSlug(null, null, s.name);
}

/** Registry namespace → publisher: io.github.<owner> → owner; reverse-DNS (com.stripe) → stripe.com. */
function publisherOf(name: string): string | null {
  const ns = name.split("/")[0];
  if (!ns) return null;
  const gh = ns.match(/^io\.github\.(.+)$/i);
  if (gh) return gh[1];
  return ns.split(".").reverse().join(".");
}

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
/** Local server name for `claude mcp add`; generic leaves ("mcp", "server") fall back to the title or namespace. */
const shortName = (s: ServerJson) => {
  const leaf = lastSegment(s.name);
  if (norm(leaf).length >= 2) return toId(leaf);
  return toId(s.title ?? "") || toId(publisherOf(s.name)?.split(".")[0] ?? "") || toId(leaf) || "mcp";
};

const shellQuote = (s: string) => (/^[A-Za-z0-9@%+=:,./_-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** Fixed package arguments, or null when a required/secret/templated argument makes a static command impossible. */
function fixedArgs(args: Argument[] | undefined): string[] | null {
  const out: string[] = [];
  for (const a of args ?? []) {
    const value = a.value ?? a.default;
    if (a.isSecret || (value && /\{[^}]+\}/.test(value))) return null;
    if (value == null || value === "") {
      if (a.isRequired) return null;
      continue;
    }
    if (a.type === "named" && a.name) out.push(a.name, value);
    else out.push(value);
  }
  return out;
}

function remoteInstall(s: ServerJson): string | null {
  const usable = (s.remotes ?? []).filter((r) => r.url && !/\{[^}]+\}/.test(r.url));
  const r = usable.find((x) => x.type === "streamable-http") ?? usable.find((x) => x.type === "sse");
  if (!r?.url) return null;
  const transport = r.type === "sse" ? "sse" : "http";
  return `claude mcp add --transport ${transport} ${shortName(s)} ${shellQuote(r.url)}`;
}

function packageInstall(s: ServerJson): string | null {
  for (const p of s.packages ?? []) {
    if (!p.identifier || (p.transport?.type ?? "stdio") !== "stdio") continue;
    if (p.runtimeArguments?.length) continue; // runtime flags vary per runtime; omit rather than guess
    const args = fixedArgs(p.packageArguments);
    if (!args) continue;
    const name = shortName(s);
    const tail = args.length ? " " + args.map(shellQuote).join(" ") : "";
    switch (p.registryType) {
      case "npm":
        return `claude mcp add ${name} -- npx -y ${shellQuote(p.version ? `${p.identifier}@${p.version}` : p.identifier)}${tail}`;
      case "pypi":
        return `claude mcp add ${name} -- uvx ${shellQuote(p.version ? `${p.identifier}==${p.version}` : p.identifier)}${tail}`;
      case "oci": {
        const env = (p.environmentVariables ?? []).filter((e) => e.name).map((e) => `-e ${e.name}`).join(" ");
        return `claude mcp add ${name} -- docker run -i --rm${env ? " " + env : ""} ${shellQuote(p.identifier)}${tail}`;
      }
    }
  }
  return null;
}

/** Same pattern as run.ts invalid(). */

function stripDescriptions(auth: Record<string, unknown>): Record<string, unknown> | undefined {
  const keep = (list: unknown) =>
    (list as Record<string, unknown>[] | undefined)
      ?.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== "description")))
      .filter((x) => !SECRET_LIKE.test(JSON.stringify(x)));
  const env = keep(auth.env_vars), headers = keep(auth.headers);
  return env?.length || headers?.length ? { ...(env?.length ? { env_vars: env } : {}), ...(headers?.length ? { headers } : {}) } : undefined;
}

const describe = (d: string | undefined) => (d ? (d.length > 300 ? d.slice(0, 300) + "…" : d) : undefined);

/** Names + flags + descriptions only. Values/defaults are never copied. */
function authOf(s: ServerJson): Record<string, unknown> | undefined {
  const env = new Map<string, Record<string, unknown>>();
  for (const p of s.packages ?? []) {
    for (const e of p.environmentVariables ?? []) {
      if (!e.name || env.has(e.name)) continue;
      env.set(e.name, { name: e.name, is_secret: !!e.isSecret, is_required: !!e.isRequired, description: describe(e.description) });
    }
  }
  const headers = new Map<string, Record<string, unknown>>();
  for (const r of s.remotes ?? []) {
    for (const h of r.headers ?? []) {
      if (!h.name || headers.has(h.name)) continue;
      headers.set(h.name, { name: h.name, is_secret: !!h.isSecret, is_required: !!h.isRequired, description: describe(h.description) });
    }
  }
  if (!env.size && !headers.size) return undefined;
  return {
    ...(env.size ? { env_vars: [...env.values()] } : {}),
    ...(headers.size ? { headers: [...headers.values()] } : {}),
  };
}

function toRecord(entry: Entry): SourceRecord | null {
  const s = entry.server;
  if (!s?.name) return null;
  const meta = (entry._meta?.[OFFICIAL_META] ?? {}) as OfficialMeta;
  if (meta.isLatest === false) return null; // one record per server name

  const hasRemote = (s.remotes ?? []).some((r) => r.type === "streamable-http" || r.type === "sse");
  const hasPackage = (s.packages ?? []).length > 0;
  const install: Record<string, string> = {};
  const cmd = remoteInstall(s) ?? packageInstall(s);
  // run.ts invalid() has no word boundary on "sk-", so names like "…desk-…", "task-…", "risk-…" read as secrets and
  // would reject the whole record; drop just the command (or auth descriptions) instead.
  if (cmd && !SECRET_LIKE.test(cmd)) install.claude_code = cmd;
  let auth = authOf(s);
  if (auth && SECRET_LIKE.test(JSON.stringify(auth))) auth = stripDescriptions(auth);

  const title = s.title?.trim();
  const repoUrl = s.repository?.url ?? null;
  return {
    slug: slugFor(s),
    kind: "mcp_server",
    name: title || s.name,
    description: s.description ?? null,
    publisher: publisherOf(s.name),
    homepage_url: s.websiteUrl ?? null,
    repo_url: repoUrl,
    // The registry name (io.github.owner/repo) would match "github" → version-control, so categorize on title/leaf.
    categories: categorize(`${title || lastSegment(s.name)} ${s.description ?? ""}`),
    clients_supported: hasRemote ? ALL_CLIENTS : hasPackage ? LOCAL_CLIENTS : undefined,
    runtime_compat: ["executor_session"],
    install: Object.keys(install).length ? install : undefined,
    auth,
    quality: {
      registry_version: s.version ?? null,
      registry_published_at: meta.publishedAt ?? null,
      registry_updated_at: meta.updatedAt ?? null,
    },
    status: meta.status ?? "active",
    source_id: s.name,
    // No per-server human page exists on the registry; the API detail URL is the item's canonical location.
    source_url: `${BASE}/v0.1/servers/${encodeURIComponent(s.name)}/versions/latest`,
    raw: trimRaw(entry),
  };
}

export const mcpRegistryAdapter: SourceAdapter = {
  name: "mcp_registry",
  curated: false,
  docs: { url: "https://registry.modelcontextprotocol.io/openapi.yaml", verified_on: "2026-11-08" },

  async *fetch(ctx) {
    // Cursor = RFC3339 updatedAt high-water mark, passed back as updated_since (which also returns deleted servers).
    const since = ctx.cursor && !Number.isNaN(Date.parse(ctx.cursor)) ? ctx.cursor : null;
    // Cap the next cursor at crawl start (minus clock-skew margin) so servers updated mid-crawl, earlier in the
    // name-ordered listing, are picked up next run.
    const crawlStart = new Date(Date.now() - 10 * 60_000).toISOString();
    let maxUpdated = since ?? "";
    let pageCursor: string | undefined;
    let yielded = 0;
    let pages = 0;

    for (;;) {
      const q = new URLSearchParams({ limit: String(PAGE), version: "latest" });
      if (since) q.set("updated_since", since);
      if (pageCursor) q.set("cursor", pageCursor);
      const res = await fetchJson<ListResponse>(`${BASE}/v0.1/servers?${q}`, { minIntervalMs: MIN_INTERVAL_MS });
      pages++;

      let batch: SourceRecord[] = [];
      for (const entry of res.servers ?? []) {
        const rec = toRecord(entry);
        if (!rec) continue;
        const upd = (entry._meta?.[OFFICIAL_META] as OfficialMeta | undefined)?.updatedAt;
        if (upd && Date.parse(upd) > (Date.parse(maxUpdated) || 0)) maxUpdated = upd; // RFC3339 with varying fraction digits: compare as dates
        batch.push(rec);
      }
      if (ctx.limit && yielded + batch.length > ctx.limit) batch = batch.slice(0, ctx.limit - yielded);
      if (batch.length) {
        yielded += batch.length;
        yield batch;
      }
      if (ctx.limit && yielded >= ctx.limit) {
        ctx.log(`limit ${ctx.limit} reached after ${pages} pages; cursor not advanced`);
        return null; // partial crawl: keep the previous cursor
      }
      pageCursor = res.metadata?.nextCursor;
      if (!pageCursor || !(res.servers ?? []).length) break;
    }

    ctx.log(`${yielded} servers over ${pages} pages${since ? ` updated since ${since}` : ""}`);
    if (!maxUpdated) return since;
    return Date.parse(maxUpdated) < Date.parse(crawlStart) ? maxUpdated : crawlStart;
  },
};
