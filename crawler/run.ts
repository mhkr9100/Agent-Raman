// Catalog crawler entry point.
//   npm run crawl -- <source|all> [--dry-run] [--limit N] [--full] [--embed N]
// --dry-run   fetch + normalize only; print a sample, write nothing (no service key needed)
// --full      ignore the stored cursor
// --embed N   after upserting, embed up to N pending capabilities (default 2000)
import { ADAPTERS } from "./sources";
import { embedPending } from "./embed";
import { WRITE_CAP_BYTES, dbBytes, readCursor, serviceClient, upsertBatch, writeSync } from "./db";
import { CATEGORY_NAMES } from "./taxonomy";
import { SECRET_LIKE } from "./secrets";
import type { SourceAdapter, SourceRecord } from "./types";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUE_FLAGS = new Set(["--limit", "--embed"]);
const target = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1] ?? "")) ?? "all";
const dryRun = flag("dry-run");
const limit = opt("limit") ? Number(opt("limit")) : undefined;
const embedMax = Number(opt("embed") ?? 2000);

const VALID_CATEGORIES = new Set<string>(CATEGORY_NAMES);
/** Reject records that would break the catalog contract; return the reason or null. */
export function invalid(r: SourceRecord): string | null {
  if (!r.slug || r.slug !== r.slug.toLowerCase() || !/^[a-z_]+:.+/.test(r.slug)) return `bad slug ${r.slug}`;
  if (!r.source_id) return "missing source_id";
  if (!r.name?.trim()) return "missing name";
  const bad = (r.categories ?? []).filter((c) => !VALID_CATEGORIES.has(c));
  if (bad.length) return `unknown categories ${bad.join(",")}`;
  const authText = JSON.stringify(r.auth ?? {}) + JSON.stringify(r.install ?? {});
  if (SECRET_LIKE.test(authText)) return "secret-like value in auth/install";
  return null;
}

async function crawl(adapter: SourceAdapter) {
  const log = (m: string) => console.log(`[${adapter.name}] ${m}`);
  const db = dryRun ? null : serviceClient();
  const cursor = dryRun || flag("full") || !db ? null : await readCursor(db, adapter.name);
  let seen = 0, written = 0, rejected = 0;
  const sample: SourceRecord[] = [];
  const it = adapter.fetch({ cursor, limit, log });

  try {
    let step = await it.next();
    while (!step.done) {
      const batch = step.value.filter((r) => {
        const why = invalid(r);
        if (why) { rejected++; if (rejected <= 5) log(`reject ${r.source_id}: ${why}`); }
        return !why;
      });
      seen += step.value.length;
      if (dryRun) sample.push(...batch.slice(0, Math.max(0, 3 - sample.length)));
      else if (batch.length) {
        const bytes = await dbBytes(db!);
        if (bytes > WRITE_CAP_BYTES) throw new Error(`database at ${Math.round(bytes / 2 ** 20)} MB, over the ${WRITE_CAP_BYTES / 2 ** 20} MB write cap; stopping`);
        written += await upsertBatch(db!, adapter.name, adapter.curated, batch);
      }
      if (limit && seen >= limit) break;
      step = await it.next();
    }
    const nextCursor = step.done ? (step.value ?? null) : null;
    log(`seen ${seen}, written ${written}, rejected ${rejected}`);
    // A full crawl that finds nothing means the source changed shape or is down — never record it as "ok".
    if (!cursor && !limit && seen === 0) throw new Error("full crawl returned 0 records (source down or response shape changed)");
    if (dryRun) {
      console.log(JSON.stringify(sample.map(({ raw: _raw, ...r }) => r), null, 2));
    } else {
      await writeSync(db!, adapter.name, { cursor: nextCursor ?? cursor, last_status: rejected ? "partial" : "ok", rows_upserted: written });
    }
    return { seen, written, rejected };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`FAILED: ${message}`);
    if (db) await writeSync(db, adapter.name, { last_status: "failed", rows_upserted: written, error: message.slice(0, 500) });
    throw err;
  }
}

async function main() {
  const adapters = target === "all" ? ADAPTERS : ADAPTERS.filter((a) => a.name === target);
  if (!adapters.length) {
    console.error(`unknown source "${target}". Known: ${ADAPTERS.map((a) => a.name).join(", ")}`);
    process.exit(2);
  }
  let failures = 0;
  for (const a of flag("embed-only") ? [] : adapters) {
    try { await crawl(a); } catch { failures++; } // one failing source never stops the others
  }
  if (!dryRun && embedMax > 0) {
    const n = await embedPending(serviceClient(), embedMax, (m) => console.log(`[embed] ${m}`));
    console.log(`[embed] embedded ${n}`);
  }
  process.exit(failures ? 1 : 0);
}

if (process.argv[1]?.endsWith("run.ts")) main();
