// Source adapter: punkpeye/awesome-mcp-servers (curated list, MIT).
// Endpoint: raw README on the default branch (main, checked via https://api.github.com/repos/punkpeye/awesome-mcp-servers).
// Docs (README incl. Legend): https://github.com/punkpeye/awesome-mcp-servers — verified_on 2026-11-08.
// Format: "### <emoji> <a name="anchor"></a>Section" headings under "## Server Implementations", then items
//   "- [owner/repo](https://github.com/owner/repo[/tree/<branch>/<path>]) [![glama badge](…)](…) <legend emoji…> - description".
// The README text is untrusted data: it is parsed and stored, never followed.
import { fetchText, trimRaw } from "../http";
import { githubPath, mcpSlug } from "../slug";
import { categorize } from "../taxonomy";
import type { SourceAdapter, SourceRecord } from "../types";

const README_URL = "https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md";
const REPO_URL = "https://github.com/punkpeye/awesome-mcp-servers";
const BATCH = 200;

const VS16 = /️/g; // emoji variation selector — README items are inconsistent about it
const normEmoji = (s: string) => s.replace(VS16, "").trim();
const kebab = (s: string) =>
  s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9+#]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Parse the README "## Legend" section into emoji → scope tag. Groups ("programming language", "scope",
 * "operating system") become the tag prefix; top-level entries (e.g. "official implementation") stand alone.
 */
function parseLegend(md: string): Map<string, string> {
  const map = new Map<string, string>();
  const start = md.search(/^## Legend\s*$/m);
  if (start < 0) return map;
  const rest = md.slice(start).split("\n").slice(1);
  let group: string | null = null;
  for (const line of rest) {
    if (/^#{1,6} /.test(line)) break;
    const m = line.match(/^(\s*)\*\s+(.+?)\s*$/);
    if (!m) continue;
    const nested = m[1].length > 0;
    const entry = m[2].match(/^(\S+)\s+[-–—]\s+(.+)$/);
    if (!entry) {
      if (!nested) group = kebab(m[2]); // group header, e.g. "programming language"
      continue;
    }
    const meaning = kebab(entry[2].replace(/\b(codebase|for)\b/gi, ""));
    if (!meaning) continue;
    const prefix = nested && group ? `${group.replace(/^programming-/, "").replace(/^operating-system$/, "os")}:` : "";
    map.set(normEmoji(entry[1]), `${prefix}${meaning}`);
    if (!nested) group = null;
  }
  return map;
}

/** Strip markdown/HTML/emoji from list text; keep link text. */
function plainText(s: string): string {
  // Odd segments are inline code spans: keep them verbatim (e.g. "terse proxy -- <server>").
  return s
    .split("`")
    .map((seg, i) =>
      i % 2
        ? seg
        : seg
            .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "") // linked badge images
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
            .replace(/<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>/gi, "") // HTML tags
            .replace(/\*\*|__|(?<![\w*])\*(?!\s)|(?<!\s)\*(?![\w*])/g, "") // bold/italic markers
            .replace(/[\p{Extended_Pictographic}⃣️‍]/gu, ""),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

interface Entry {
  linkText: string;
  url: string;
  sections: { title: string; anchor: string }[];
  badges: string[];
  description: string;
  line: string;
}

function parseServers(md: string, legend: Map<string, string>): { entries: Entry[]; skipped: number } {
  const lines = md.split("\n");
  const begin = lines.findIndex((l) => /^## Server Implementations\s*$/.test(l));
  if (begin < 0) throw new Error("awesome-mcp: '## Server Implementations' heading not found — README format changed");
  const bySlugKey = new Map<string, Entry>();
  let section: { title: string; anchor: string } | null = null;
  let skipped = 0;

  for (let i = begin + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^## /.test(line)) break; // next top-level section (Frameworks, Tips…) is not servers
    const h = line.match(/^###\s+(.*)$/);
    if (h) {
      const anchor = h[1].match(/<a name="([^"]+)"/)?.[1] ?? kebab(plainText(h[1]));
      section = { title: plainText(h[1]), anchor };
      continue;
    }
    const item = line.match(/^\s*[-*]\s+\[([^\]]+)\]\(([^)\s]+)\)(.*)$/);
    if (!item || !section) continue;
    const [, linkText, url, tail] = item;
    const key = githubPath(url);
    if (!key) { skipped++; continue; } // non-GitHub link: no stable cross-source slug

    // Separate the badge run (glama score image + legend emoji) from the description at the first " - ".
    const afterBadge = tail.replace(/^\s*\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/, "");
    const sep = afterBadge.match(/^(.*?)\s[-–—]\s(.*)$/);
    const badgeRun = sep ? sep[1] : "";
    const desc = sep ? sep[2] : afterBadge;
    const badges = badgeRun
      .split(/\s+/)
      .map(normEmoji)
      .filter(Boolean)
      .map((e) => legend.get(e))
      .filter((t): t is string => !!t);

    const prev = bySlugKey.get(key);
    if (prev) { // same repo listed in several sections → one record, union of sections/badges
      if (!prev.sections.some((s) => s.anchor === section!.anchor)) prev.sections.push(section);
      for (const b of badges) if (!prev.badges.includes(b)) prev.badges.push(b);
      if (!prev.description) prev.description = plainText(desc);
      continue;
    }
    bySlugKey.set(key, {
      linkText: linkText.trim(),
      url,
      sections: [section],
      badges: [...new Set(badges)],
      description: plainText(desc),
      line,
    });
  }
  return { entries: [...bySlugKey.values()], skipped };
}

function toRecord(e: Entry): SourceRecord {
  const path = githubPath(e.url)!; // github.com/owner/repo[/sub]
  const owner = new URL(e.url).pathname.split("/").filter(Boolean)[0] ?? null;
  const name = plainText(e.linkText) || path.split("/").slice(1).join("/");
  const sectionTitles = e.sections.map((s) => s.title);
  return {
    slug: mcpSlug(e.url, null, e.linkText),
    kind: "mcp_server",
    name,
    description: e.description || null,
    publisher: owner,
    official: e.badges.includes("official-implementation") || undefined,
    repo_url: e.url,
    categories: categorize(`${name} ${e.description}`, sectionTitles),
    scope_tags: e.badges,
    clients_supported: [],
    runtime_compat: ["executor_session"],
    install: {},
    auth: {},
    signals: {},
    source_id: path,
    source_url: e.url,
    raw: trimRaw({
      line: e.line,
      sections: e.sections.map((s) => ({ ...s, url: `${REPO_URL}#${s.anchor}` })),
      badges: e.badges,
    }),
  };
}

export const awesomeMcp: SourceAdapter = {
  name: "awesome_mcp",
  curated: true,
  docs: { url: REPO_URL, verified_on: "2026-11-08" },
  async *fetch(ctx) {
    const md = await fetchText(README_URL, { headers: { Accept: "text/plain" } });
    const legend = parseLegend(md);
    if (!legend.size) ctx.log("legend not found — scope_tags will be empty");
    const { entries, skipped } = parseServers(md, legend);
    ctx.log(`parsed ${entries.length} unique servers (${skipped} non-GitHub links skipped, ${legend.size} legend badges)`);

    const limit = ctx.limit ?? Infinity;
    let yielded = 0;
    for (let i = 0; i < entries.length && yielded < limit; i += BATCH) {
      const batch = entries.slice(i, Math.min(i + BATCH, i + (limit - yielded))).map(toRecord);
      yielded += batch.length;
      yield batch;
    }
    return null; // single fetch; no incremental cursor
  },
};
