// Binder eval runner (RAMAN-TASK R6 gate).
//   npm run eval:binder                 retrieval + re-rank only (no LLM): expected item in top-3 / top-8
//   npm run eval:binder -- --llm        full bind with the eval key: bound-correct rate + cadence trap
//   npm run eval:binder -- --only slack-post --verbose
// --llm reads EVAL_PROVIDER, EVAL_MODEL, EVAL_API_KEY (and EVAL_BASE_URL for openai_compatible) from
// .env.local. That key is the developer's own, local only; the app never reads it (it takes keys per request).
import { readFileSync } from "node:fs";
import { bind, type BindResult } from "../src/lib/binder";
import { anthropicWebSearch } from "../src/lib/binder/web";
import type { NeedInput } from "../src/lib/binder/types";
import { languageModel, PROVIDERS, type LlmConfig, type Provider } from "../src/lib/llm";
import { embedQuery, serverDb } from "../src/lib/supabase-server";

type Item = NeedInput & { id: string; accept: string[]; expect_status?: BindResult["status"][] };

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const target = (slug: string) => slug.toLowerCase().replace("github.com/", "");
const hits = (slug: string, accept: string[]) => accept.some((a) => target(slug).includes(a));

async function main() {
  const set = JSON.parse(readFileSync("evals/binder.json", "utf8")) as { items: Item[] };
  let items = set.items;
  if (opt("only")) items = items.filter((i) => i.id === opt("only"));

  let cfg: LlmConfig | null = null;
  if (flag("llm")) {
    const provider = process.env.EVAL_PROVIDER as Provider;
    if (!PROVIDERS.includes(provider) || !process.env.EVAL_API_KEY || !process.env.EVAL_MODEL) {
      throw new Error(`--llm needs EVAL_PROVIDER (${PROVIDERS.join("|")}), EVAL_MODEL and EVAL_API_KEY in .env.local`);
    }
    cfg = { provider, model: process.env.EVAL_MODEL, apiKey: process.env.EVAL_API_KEY, baseURL: process.env.EVAL_BASE_URL };
  }
  const model = cfg ? languageModel(cfg) : null;
  const webSearch = cfg && flag("web") ? anthropicWebSearch(cfg) : null;
  const db = serverDb();

  let scored = 0, top3 = 0, top8 = 0, boundOk = 0, boundWrong = 0, notBound = 0, trapOk = 0, trapN = 0, errors = 0;
  const ms: number[] = [];
  for (const item of items) {
    const isTrap = !!item.expect_status;
    if (isTrap && !model) continue;
    const t0 = Date.now();
    let r: BindResult;
    try {
      r = await bind(item, { db, embed: embedQuery, model, webSearch });
    } catch (e) {
      errors++;
      if (!isTrap) scored++; // an error is a miss, never a skipped item
      console.log(`✗ ${item.id.padEnd(22)} ERROR ${(e as Error).message.slice(0, 160)}`);
      continue;
    }
    ms.push(Date.now() - t0);
    const slugs = r.candidates.map((c) => c.card.slug);
    if (isTrap) {
      trapN++;
      const ok = item.expect_status!.includes(r.status);
      if (ok) trapOk++;
      console.log(`${ok ? "✓" : "✗"} ${item.id.padEnd(22)} status=${r.status}${r.primary ? ` primary=${r.primary.card.slug}` : ""}`);
      continue;
    }
    scored++;
    const in3 = slugs.slice(0, 3).some((s) => hits(s, item.accept));
    const in8 = slugs.slice(0, 8).some((s) => hits(s, item.accept));
    if (in3) top3++;
    if (in8) top8++;
    let bindNote = "";
    if (model) {
      if (r.status === "bound" && r.primary && hits(r.primary.card.slug, item.accept)) { boundOk++; bindNote = ` bound=${r.primary.card.slug}`; }
      else if (r.status === "bound") { boundWrong++; bindNote = ` WRONG-BIND=${r.primary!.card.slug}`; }
      else { notBound++; bindNote = ` ${r.status}`; }
    }
    console.log(`${in3 ? "✓" : in8 ? "~" : "✗"} ${item.id.padEnd(22)} top3=${slugs.slice(0, 3).join(" | ")}${bindNote}`);
    if (flag("verbose")) {
      for (const c of r.candidates) console.log(`    ${c.score.toFixed(4)} rrf=${c.rrf.toFixed(4)} ${JSON.stringify(c.ranks)} ${c.card.slug}`);
      if (r.judgment) console.log(`    judge: ${r.judgment.verdict} — ${r.judgment.reason}`);
    }
  }
  ms.sort((a, b) => a - b);
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
  console.log("\n— summary —");
  console.log(`items scored ${scored} · top-3 ${top3} (${pct(top3, scored)}) · top-8 ${top8} (${pct(top8, scored)}) · errors ${errors}`);
  if (model) console.log(`bound correct ${boundOk} · wrong bind ${boundWrong} · not bound ${notBound} · cadence trap ${trapOk}/${trapN}`);
  console.log(`latency p50 ${ms[Math.floor(ms.length / 2)] ?? "-"} ms · p95 ${ms[Math.floor(ms.length * 0.95)] ?? "-"} ms`);
  const gate = errors === 0 && scored > 0 && top3 / scored >= 0.8 && (!model || (trapOk === trapN && boundWrong === 0));
  console.log(gate ? "GATE PASS" : "GATE FAIL");
  process.exit(gate ? 0 : 1);
}

main();
