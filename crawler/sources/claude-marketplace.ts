// Source adapter: Anthropic's official Claude Code plugin marketplace (anthropics/claude-plugins-official, Apache-2.0).
// Endpoint: https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json
//   (one file, ~317 plugins on 2026-11-08; top-level: $schema, name, description, owner, renames, plugins[]).
// Docs (verified_on 2026-11-08):
//   - https://code.claude.com/docs/en/plugin-marketplaces            (marketplace file, source types)
//   - https://code.claude.com/docs/en/plugins/marketplace-reference  (plugin entry fields; relative/github/url/git-subdir/npm/archive/command sources)
//   - https://code.claude.com/docs/en/discover-plugins               (install command; "Claude Code adds Anthropic's official
//     marketplace for you the first time you start an interactive terminal session", so no `marketplace add` step is needed)
// Listing pages: https://claude.com/marketplace/plugins/<name> (canonical link of claude.com/plugins/<name>); ~93% of entries
//   had one on 2026-11-08, the rest (mostly newly added entries) 404 until the site catches up.
// The marketplace file is untrusted data: stored, never followed.
import { fetchJson, trimRaw } from "../http";
import { pluginSlug } from "../slug";
import { categorize } from "../taxonomy";
import type { SourceAdapter, SourceRecord } from "../types";

const MARKETPLACE_URL =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";
const MARKETPLACE_REPO = "https://github.com/anthropics/claude-plugins-official";
const DEFAULT_MARKETPLACE = "claude-plugins-official";
const LISTING_URL = "https://claude.com/marketplace/plugins/";
const BATCH = 200;

interface Author { name?: string; email?: string; url?: string }
type PluginSource =
  | string
  | { source?: string; repo?: string; url?: string; path?: string; ref?: string; sha?: string; package?: string; command?: string };

interface PluginEntry {
  name?: string;
  displayName?: string;
  description?: string;
  author?: Author | string;
  category?: string;
  homepage?: string;
  tags?: unknown;
  keywords?: unknown;
  source?: PluginSource;
  version?: string;
}

interface Marketplace {
  name?: string;
  owner?: Author;
  plugins?: PluginEntry[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Full GitHub URL from "owner/repo", "https://github.com/owner/repo(.git)", or "git@github.com:owner/repo.git". */
function githubRepoUrl(urlOrShorthand: string | undefined): string | null {
  if (!urlOrShorthand) return null;
  const s = urlOrShorthand.trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) return `https://github.com/${s.replace(/\.git$/, "")}`;
  const m = s.match(/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

const withPath = (repo: string, ref: string | undefined, path: string | undefined) => {
  const p = path?.replace(/^\.?\/+|\/+$/g, "");
  return p ? `${repo}/tree/${ref || "HEAD"}/${p}` : repo;
};

/** Where the plugin's code lives on GitHub, per the documented source types. Null for npm/archive/command/non-GitHub. */
function repoUrlFor(source: PluginSource | undefined): string | null {
  if (typeof source === "string") {
    // Relative path inside the marketplace repo ("./plugins/x"; "./" or "." is the repo root).
    if (!source.startsWith(".")) return null; // bare names need metadata.pluginRoot, which this file does not set
    return withPath(MARKETPLACE_REPO, "main", source);
  }
  if (!source || typeof source !== "object") return null;
  switch (source.source) {
    case "github": {
      const repo = githubRepoUrl(source.repo);
      return repo ? withPath(repo, source.ref, source.path) : null;
    }
    case "url":
    case "git-subdir": {
      const repo = githubRepoUrl(source.url);
      return repo ? withPath(repo, source.ref, source.path) : null;
    }
    default:
      return null; // npm, archive, command
  }
}

const authorName = (a: PluginEntry["author"]): string | null =>
  typeof a === "string" ? str(a) : a && typeof a === "object" ? str(a.name) : null;

function toRecord(p: PluginEntry, marketplace: string): SourceRecord | null {
  const id = str(p.name);
  if (!id) return null;
  const description = str(p.description);
  const tags = strList(p.tags);
  const keywords = strList(p.keywords);
  const category = str(p.category);
  const publisher = authorName(p.author);
  const sourceType = typeof p.source === "string" ? "relative" : (str(p.source?.source) ?? "unknown");

  return {
    slug: pluginSlug(marketplace, id),
    kind: "plugin",
    name: str(p.displayName) ?? id,
    description,
    publisher,
    // Official = written by Anthropic (author "Anthropic", incl. "Anthropic / Model Context Protocol"). The marketplace
    // owner is Anthropic for every entry, so it is not used: most entries are third-party plugins Anthropic lists.
    official: publisher ? /^anthropic\b/i.test(publisher) : false,
    homepage_url: str(p.homepage),
    repo_url: repoUrlFor(p.source),
    categories: categorize([id, str(p.displayName), description, category].filter(Boolean).join(" "), [...tags, ...keywords]),
    scope_tags: [...new Set([...tags, ...keywords].map((t) => t.toLowerCase()))],
    clients_supported: ["claude_code"],
    runtime_compat: ["executor_session"],
    // The official marketplace is added automatically on the first interactive session (discover-plugins docs).
    install: { claude_code: `/plugin install ${id}@${marketplace}` },
    quality: {
      marketplace_category: category,
      source_type: sourceType,
      ...(typeof p.source === "object" && p.source?.sha ? { pinned_sha: p.source.sha } : {}),
      ...(str(p.version) ? { version: str(p.version) } : {}),
    },
    status: "active",
    source_id: id,
    source_url: `${LISTING_URL}${encodeURIComponent(id)}`,
    raw: trimRaw(p),
  };
}

export const claudeMarketplace: SourceAdapter = {
  name: "claude_marketplace",
  curated: true,
  docs: { url: "https://code.claude.com/docs/en/plugins/marketplace-reference", verified_on: "2026-11-08" },

  async *fetch(ctx) {
    const file = await fetchJson<Marketplace>(MARKETPLACE_URL, { minIntervalMs: 1000 });
    const marketplace = str(file.name) ?? DEFAULT_MARKETPLACE;
    const plugins = Array.isArray(file.plugins) ? file.plugins : [];
    ctx.log(`marketplace ${marketplace}: ${plugins.length} plugins`);

    const limit = ctx.limit ?? Infinity;
    const seen = new Set<string>();
    let yielded = 0;
    let batch: SourceRecord[] = [];
    for (const p of plugins) {
      if (yielded + batch.length >= limit) break;
      const rec = toRecord(p, marketplace);
      if (!rec || seen.has(rec.slug)) continue; // plugin names are unique per marketplace; guard anyway
      seen.add(rec.slug);
      batch.push(rec);
      if (batch.length >= BATCH) {
        yielded += batch.length;
        yield batch;
        batch = [];
      }
    }
    if (batch.length) yield batch;
    return null; // single file, no incremental cursor
  },
};
