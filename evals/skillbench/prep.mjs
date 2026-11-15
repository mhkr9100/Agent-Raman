// PM skill pilot, step 2: save the specs and build blind review packets (design: evals/skillbench/PM-PILOT.md).
//   node evals/skillbench/prep.mjs <write-workflow transcript dir> <work dir>
// Writes <work dir>/out/<arm>-<task>.md, <work dir>/packets/<task>-j<n>/P1..P4.md (shuffled per reviewer),
// <work dir>/key.json (which arm is which; not in the packet dirs) and <work dir>/metrics.json (tokens per spec).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [wf, work] = process.argv.slice(2);
if (!wf || !work) { console.error("usage: node evals/skillbench/prep.mjs <workflow transcript dir> <work dir>"); process.exit(2); }
const lines = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const { tasks } = JSON.parse(readFileSync("evals/skillbench/tasks.json", "utf8"));
const ARMS = ["N", "S1", "S2", "S3"];

const journal = lines(join(wf, "journal.jsonl"));
const label = new Map(journal.filter((l) => l.type === "started").map((l) => [l.agentId, l.label]));
mkdirSync(join(work, "out"), { recursive: true });
const metrics = [];
for (const r of journal.filter((l) => l.type === "result")) {
  const name = label.get(r.agentId);
  if (!name) continue;
  const text = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  writeFileSync(join(work, "out", `${name}.md`), text);
  const per = new Map();
  for (const l of lines(join(wf, `agent-${r.agentId}.jsonl`))) if (l.type === "assistant" && l.message?.usage) per.set(l.requestId ?? l.uuid, l.message.usage);
  const sum = (k) => [...per.values()].reduce((n, u) => n + (u[k] ?? 0), 0);
  const u = { input: sum("input_tokens"), cache_write: sum("cache_creation_input_tokens"), cache_read: sum("cache_read_input_tokens"), output: sum("output_tokens") };
  metrics.push({ label: name, arm: name.split("-")[0], chars: text.length, ...u, cost_index: Math.round(u.input + 1.25 * u.cache_write + 0.1 * u.cache_read + 5 * u.output) });
}
writeFileSync(join(work, "metrics.json"), JSON.stringify(metrics, null, 1));

function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h |= 0; h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Light blinding: drop words that name a skill or its loop. The S2 format (a JSON task list) stays recognisable.
const blind = (s) => s.replace(/\bralph\/?/gi, "").replace(/write-spec|product-manager skill|PRD skill/gi, "the method");
const key = {};
for (const t of tasks) for (const j of [1, 2]) {
  const order = [...ARMS];
  const next = rng(`pm/${t.id}/${j}`);
  for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(next() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
  const dir = join(work, "packets", `${t.id}-j${j}`);
  mkdirSync(dir, { recursive: true });
  key[`${t.id}-j${j}`] = {};
  order.forEach((arm, i) => {
    const f = join(work, "out", `${arm}-${t.id}.md`);
    writeFileSync(join(dir, `P${i + 1}.md`), existsSync(f) ? blind(readFileSync(f, "utf8")) : "(no output)");
    key[`${t.id}-j${j}`][`P${i + 1}`] = arm;
  });
}
writeFileSync(join(work, "key.json"), JSON.stringify(key, null, 1));
console.log(`saved ${metrics.length} specs, wrote ${Object.keys(key).length} packets`);
for (const a of ARMS) { const g = metrics.filter((m) => m.arm === a); const mean = (k) => Math.round(g.reduce((n, m) => n + m[k], 0) / Math.max(1, g.length)); console.log(`${a}: specs ${g.length}, mean chars ${mean("chars")}, output tokens ${mean("output")}, cost index ${mean("cost_index")}`); }
