// Checker test, step 2: build the packets the reviewers read (design: evals/ab/CHECK-TEST.md).
//   node evals/ab/check-prep.mjs <packet dir> [first-test results = evals/results/ab] [results = evals/results/check]
// Per plan (6 requests x 2 planner models): the original (O), the one-line pass (V1) and the one-line + check
// pass (V2) as X1.md to X3.md in a fixed shuffled order, plus faults.md: what the first test's reviewers marked
// wrong in the original. The product name is replaced in the copies (light blinding only). The order key is
// written to the results dir, not to the packet dir.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [packets, first = "evals/results/ab", out = "evals/results/check"] = process.argv.slice(2);
if (!packets) { console.error("usage: node evals/ab/check-prep.mjs <packet dir> [first-test results] [results]"); process.exit(2); }
const { tasks } = JSON.parse(readFileSync("evals/ab/tasks.json", "utf8"));
const judgements = JSON.parse(readFileSync(join(first, "judgements.json"), "utf8"));
const firstKey = JSON.parse(readFileSync(join(first, "judge-key.json"), "utf8"));

// Same small seeded generator as judge-prep.mjs, so the order is the same on every run.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h |= 0; h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const blind = (s) => s.replace(/Agent\s?Raman|\bRaman\b/gi, "the planner");
const clip = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);

const key = {};
let faults = 0;
for (const task of tasks) for (const model of ["sonnet", "haiku"]) {
  const id = `${task.id}-${model}`;
  const files = { O: join(first, `A-${id}.task.md`), V1: join(out, `V1-${id}.task.md`), V2: join(out, `V2-${id}.task.md`) };
  const next = rng(`check/${id}`);
  const order = ["O", "V1", "V2"];
  for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(next() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
  const dir = join(packets, id);
  mkdirSync(dir, { recursive: true });
  key[id] = {};
  order.forEach((arm, i) => { writeFileSync(join(dir, `X${i + 1}.md`), blind(readFileSync(files[arm], "utf8"))); key[id][`X${i + 1}`] = arm; });

  // Faults the first test's reviewers found in this original: wrong claims and tools that do not exist.
  const lines = [];
  for (const p of judgements) {
    if (!p.packet.startsWith(task.id + "-j")) continue;
    for (const plan of p.plans) {
      if (firstKey[p.packet][plan.id] !== `A-${model}`) continue;
      for (const c of plan.risky_claims ?? []) if (c.verdict === "wrong") lines.push(`- Claim: ${clip(c.claim, 300)}\n  Earlier reviewer's reason: ${clip(c.evidence ?? "none given", 400)}`);
      for (const t of plan.tools ?? []) if (t.exists === "no") lines.push(`- Tool said not to exist: ${clip(t.name, 200)}\n  Earlier reviewer's reason: ${clip(t.evidence ?? "none given", 400)}`);
    }
  }
  faults += lines.length;
  writeFileSync(join(dir, "faults.md"), lines.length ? lines.join("\n") + "\n" : "None recorded.\n");
}
writeFileSync(join(out, "judge-key.json"), JSON.stringify(key, null, 1));
console.log(`wrote ${Object.keys(key).length} packets to ${packets} (${faults} fault lines from the first test)`);
