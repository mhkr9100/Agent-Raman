// Dry-run one adapter file without registering it and without a database:
//   npx tsx crawler/try-adapter.ts crawler/sources/<file>.ts [limit=300]
// Prints counts, contract violations, duplicate slugs, category coverage and 3 sample rows.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { invalid } from "./run";
import type { SourceAdapter, SourceRecord } from "./types";

async function main() {
  const [file, limitArg] = process.argv.slice(2);
  if (!file) throw new Error("usage: tsx crawler/try-adapter.ts <adapter file> [limit]");
  const limit = Number(limitArg ?? 300);
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  const adapter = Object.values(mod).find((v): v is SourceAdapter => !!v && typeof (v as SourceAdapter).fetch === "function");
  if (!adapter) throw new Error(`${file} exports no SourceAdapter`);

  const records: SourceRecord[] = [];
  const started = Date.now();
  for await (const batch of adapter.fetch({ cursor: null, limit, log: (m) => console.log(`[${adapter.name}] ${m}`) })) {
    records.push(...batch);
    if (records.length >= limit) break;
  }

  const problems = records.map((r) => [r.source_id, invalid(r)] as const).filter(([, why]) => why);
  const slugs = new Map<string, number>();
  for (const r of records) slugs.set(r.slug, (slugs.get(r.slug) ?? 0) + 1);
  const dupes = [...slugs].filter(([, n]) => n > 1);
  const withCats = records.filter((r) => r.categories?.length).length;
  const withDesc = records.filter((r) => r.description?.trim()).length;

  console.log(JSON.stringify({
    adapter: adapter.name, curated: adapter.curated, records: records.length, seconds: (Date.now() - started) / 1000,
    invalid: problems.length, invalid_examples: problems.slice(0, 5),
    duplicate_slugs_in_batch: dupes.length, duplicate_examples: dupes.slice(0, 5),
    with_categories_pct: Math.round((100 * withCats) / Math.max(1, records.length)),
    with_description_pct: Math.round((100 * withDesc) / Math.max(1, records.length)),
    kinds: [...new Set(records.map((r) => r.kind))],
    sample: records.slice(0, 3).map(({ raw: _raw, ...r }) => r),
  }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
