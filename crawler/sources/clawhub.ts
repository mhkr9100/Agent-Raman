// ClawHub skills registry (OpenClaw): public Agent Skills (SKILL.md) published by many owners.
// Endpoint: GET https://clawhub.ai/api/v1/skills?limit=<1-200>&sort=createdAt&nonSuspiciousOnly=true&cursor=<nextCursor> — no auth.
//   Docs: https://github.com/openclaw/clawhub/blob/main/docs/http-api.md (verified_on 2026-11-08)
//   - Rate limit: reads 3000/min per IP anonymous; 429 carries Retry-After (honoured by fetchJson).
//   - Items are identified by the owner-qualified pair ownerHandle/slug; slugs are NOT globally unique.
//   - Canonical listing URL: https://clawhub.ai/<owner>/skills/<slug>. Directories must cache, link back,
//     and not mirror hidden/private/moderation-blocked content.
//   - `createdAt` sort is the documented stable sort for crawls; any non-trending sort paginates by nextCursor.
//     Pages can be shorter than `limit` (server-side filtering); follow nextCursor until null.
//   - Sync modes (ctx.cursor = last-seen updatedAt, epoch ms or ISO):
//     * full (cursor null, e.g. --full / weekly): sort=createdAt over the whole catalog (~430 pages, ~45 min);
//       returns min(max updatedAt seen, crawl start) as the cursor.
//     * incremental (cursor set): sort=updated (docs: "`updated` changes when existing skills are republished";
//       live API returns newest updatedAt first) and stop at the first row older than cursor - 1h overlap;
//       returns the new max updatedAt. No updated-since filter exists, so the early stop is the filter.
//     Download/install/star counts do NOT bump updatedAt: stats only refresh on full runs.
//   - Skills later hidden/blocked/deleted on ClawHub vanish from the list; marking them deleted needs a
//     runner-level "not seen in a completed full crawl" sweep (not possible inside the adapter).
//   - List rows carry no moderation fields (those exist only on detail pages for flagged items), so we ask the
//     server to drop suspicious skills (nonSuspiciousOnly=true) and still skip any row that does expose a block.
//   - List rows expose no GitHub repo URL, so slugs fall back to skill:clawhub/<owner>/<slug>.
// Install: CLI docs https://github.com/openclaw/clawhub/blob/main/docs/cli.md (verified_on 2026-11-08):
//   `npm i -g clawhub`; `clawhub install @owner/slug` extracts into <workdir>/<--dir>/<slug> (default dir "skills").
//   Claude Code loads project skills from .claude/skills; Codex scans .agents/skills
//   (https://developers.openai.com/codex/skills, verified_on 2026-11-08).
import { fetchJson, trimRaw } from "../http";
import { skillSlug } from "../slug";
import { categorize } from "../taxonomy";
import type { SourceAdapter, SourceRecord } from "../types";
import { SECRET_LIKE } from "../secrets";

const BASE = "https://clawhub.ai";
const PAGE = 200;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Mirror of the secret check in crawler/run.ts invalid() (kept in sync by hand).
const OVERLAP_MS = 60 * 60 * 1000; // re-read the last hour of updates to absorb clock skew / write lag

/** ctx.cursor → epoch ms (accepts epoch-ms digits or an ISO date); null if absent or unparseable. */
function parseCursor(c: string | null): number | null {
  if (!c) return null;
  const t = /^\d+$/.test(c.trim()) ? Number(c.trim()) : Date.parse(c);
  return Number.isFinite(t) && t > 0 ? t : null;
}

interface ClawHubModeration {
  isSuspicious?: boolean | null;
  isMalwareBlocked?: boolean | null;
  isHidden?: boolean | null;
  verdict?: string | null;
  reasonCodes?: string[] | null;
  summary?: string | null;
}

interface ClawHubSkill {
  ownerHandle: string;
  slug: string;
  displayName?: string | null;
  summary?: string | null;
  description?: string | null;
  topics?: string[] | null;
  tags?: Record<string, string> | null;
  stats?: Record<string, number | null> | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  latestVersion?: { version?: string; createdAt?: number; changelog?: string; license?: string | null } | null;
  metadata?: {
    setup?: { key?: string; required?: boolean }[] | null;
    os?: string[] | null;
    systems?: string[] | null;
  } | null;
  // Present only on flagged items (defensive; not in the list schema today).
  moderation?: ClawHubModeration | null;
  isSuspicious?: boolean | null;
  isMalwareBlocked?: boolean | null;
  hidden?: boolean | null;
  isHidden?: boolean | null;
}

interface SkillListResponse {
  items: ClawHubSkill[];
  nextCursor?: string | null;
}

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();

function blocked(item: ClawHubSkill): boolean {
  const m = item.moderation ?? {};
  return !!(item.isMalwareBlocked || m.isMalwareBlocked || item.hidden || item.isHidden || m.isHidden);
}

const MIN_INSTALLS = 1;
const MIN_STARS = 1;

function toRecord(item: ClawHubSkill): SourceRecord {
  const owner = item.ownerHandle.trim().replace(/^@+/, "");
  const slug = item.slug.trim();
  const ownerKey = owner.toLowerCase();
  const name = (item.displayName?.trim() || slug).slice(0, 300);
  const description = item.summary?.trim() || item.description?.trim() || null;
  const topics = (item.topics ?? []).filter((t): t is string => typeof t === "string");
  const listingUrl = `${BASE}/${encodeURIComponent(owner)}/skills/${encodeURIComponent(slug)}`;

  const signals: Record<string, number> = {};
  for (const key of ["downloads", "installs", "stars", "comments"]) {
    const v = item.stats?.[key];
    if (typeof v === "number" && Number.isFinite(v)) signals[snake(key)] = v;
  }

  const setup = (item.metadata?.setup ?? []).filter((s) => typeof s?.key === "string" && ENV_NAME.test(s.key));
  const auth: Record<string, unknown> = {};
  if (setup.length) {
    auth.env = setup.map((s) => s.key);
    const required = setup.filter((s) => s.required).map((s) => s.key);
    if (required.length) auth.required_env = required;
  }

  const install: Record<string, string> = {};
  let installOmitted = false;
  if (SAFE_ID.test(owner) && SAFE_ID.test(slug)) {
    const ref = `@${ownerKey}/${slug}`;
    // run.ts invalid() rejects install text matching its secret regex; slugs such as "risk-assessment-…" contain
    // "sk-" + 20 chars and would get the whole skill dropped. Omit install for those (false positive, not a secret).
    if (SECRET_LIKE.test(ref)) installOmitted = true;
    else {
      install.claude_code = `npx -y clawhub install ${ref} --dir .claude/skills`;
      install.codex = `npx -y clawhub install ${ref} --dir .agents/skills`;
    }
  }

  const quality: Record<string, unknown> = { non_suspicious_filter: true };
  if (installOmitted) quality.install_omitted = "slug resembles a secret pattern; install from the ClawHub listing";
  if (item.latestVersion?.version) quality.latest_version = item.latestVersion.version;
  if (typeof item.stats?.versions === "number") quality.version_count = item.stats.versions;
  if (item.updatedAt) quality.updated_at = new Date(item.updatedAt).toISOString();
  if (item.createdAt) quality.created_at = new Date(item.createdAt).toISOString();
  if (item.metadata?.os?.length) quality.os = item.metadata.os;
  if (item.metadata?.systems?.length) quality.systems = item.metadata.systems;
  const mod = item.moderation;
  if (mod || item.isSuspicious != null) {
    quality.moderation = {
      is_suspicious: mod?.isSuspicious ?? item.isSuspicious ?? null,
      is_malware_blocked: mod?.isMalwareBlocked ?? item.isMalwareBlocked ?? null,
      verdict: mod?.verdict ?? null,
      reason_codes: mod?.reasonCodes ?? [],
    };
  }

  return {
    slug: skillSlug(null, null, `clawhub/${ownerKey}/${slug.toLowerCase()}`),
    kind: "skill",
    name,
    description,
    publisher: owner,
    homepage_url: listingUrl,
    categories: categorize(`${name} ${description ?? ""}`, topics),
    clients_supported: ["claude_code", "codex"],
    runtime_compat: ["executor_session"],
    ...(Object.keys(install).length ? { install } : {}),
    ...(Object.keys(auth).length ? { auth } : {}),
    signals,
    quality,
    licence: item.latestVersion?.license ?? null,
    tos_notes:
      "ClawHub public catalog reuse: cache results, link back to the canonical ClawHub listing, do not imply endorsement, do not mirror hidden/private/moderation-blocked content.",
    status: "active",
    source_id: `${ownerKey}/${slug.toLowerCase()}`,
    source_url: listingUrl,
    raw: trimRaw(item),
  };
}

export const clawhub: SourceAdapter = {
  name: "clawhub",
  curated: false,
  docs: { url: "https://github.com/openclaw/clawhub/blob/main/docs/http-api.md", verified_on: "2026-11-08" },

  async *fetch(ctx) {
    const since = parseCursor(ctx.cursor);
    const incremental = since !== null;
    const stopBefore = incremental ? since - OVERLAP_MS : -Infinity;
    const startedAt = Date.now();
    const seen = new Set<string>();
    let cursor: string | null = null;
    let yielded = 0, skipped = 0, belowFloor = 0, pages = 0, maxUpdated = 0;
    let done = false;
    if (ctx.cursor && !incremental) ctx.log(`unparseable cursor ${JSON.stringify(ctx.cursor)}: running full crawl`);

    do {
      const params = new URLSearchParams({
        limit: String(PAGE),
        sort: incremental ? "updated" : "createdAt",
        nonSuspiciousOnly: "true",
      });
      if (cursor) params.set("cursor", cursor);
      const res: SkillListResponse = await fetchJson<SkillListResponse>(`${BASE}/api/v1/skills?${params}`, {
        minIntervalMs: 1000, // far below the 3000/min anonymous read limit
      });
      if (!res || !Array.isArray(res.items)) {
        throw new Error(`clawhub: unexpected list response shape on page ${pages + 1} (no items array)`);
      }
      pages++;
      if (pages === 1 && res.items.length === 0 && !incremental) ctx.log("warning: first page returned 0 items");

      const batch: SourceRecord[] = [];
      for (const item of res.items) {
        const updated = typeof item?.updatedAt === "number" ? item.updatedAt : null;
        if (incremental && updated !== null && updated < stopBefore) { done = true; break; } // older than window
        if (updated !== null && updated > maxUpdated) maxUpdated = updated;
        if (!item?.ownerHandle || !item?.slug) { skipped++; continue; }
        if (blocked(item) || item.latestVersion === null) { skipped++; continue; } // no public version / blocked
        // Popularity floor (fits the 500 MB free tier): downloads are inflated (every sampled skill had ≥10),
        // installs/stars are the honest signal; on 2026-11-08 only 27% of the newest 3,000 skills had ≥1 install.
        if ((item.stats?.installs ?? 0) < MIN_INSTALLS && (item.stats?.stars ?? 0) < MIN_STARS) { belowFloor++; continue; }
        const rec = toRecord(item);
        if (seen.has(rec.source_id)) continue; // live pagination can repeat a row
        seen.add(rec.source_id);
        batch.push(rec);
        if (ctx.limit && yielded + batch.length >= ctx.limit) break;
      }
      if (batch.length) {
        yielded += batch.length;
        yield batch;
      }
      if (ctx.limit && yielded >= ctx.limit) {
        // Stopped early: the window was not fully read, so do not advance the cursor.
        ctx.log(`limit reached: pages ${pages}, yielded ${yielded}, skipped ${skipped}`);
        return ctx.cursor;
      }
      cursor = done ? null : (res.nextCursor ?? null);
    } while (cursor);

    // Anything republished after the crawl started may have been passed already: cap the cursor at start time.
    const next = maxUpdated > 0 ? Math.min(maxUpdated, startedAt) : since;
    ctx.log(`${incremental ? "incremental" : "full"}: pages ${pages}, yielded ${yielded}, skipped ${skipped}, below floor ${belowFloor}, cursor ${next ? new Date(next).toISOString() : "none"}`);
    return next ? String(next) : null;
  },
};
