// With/without test, step 3: build the packets the reviewers read.
//   node evals/ab/judge-prep.mjs <packet dir> [results dir = evals/results/ab]
// Per task and per reviewer (two reviewers, different orders): the four plans as P1.md to P4.md in a fixed shuffled
// order. The product name is replaced in the copies so a reviewer is not told which planner wrote a file. This is
// light blinding only: the two kinds of file still look different. The order key is written to the results dir,
// not to the packet dir.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [packets, out = "evals/results/ab"] = process.argv.slice(2);
if (!packets) { console.error("usage: node evals/ab/judge-prep.mjs <packet dir> [results dir]"); process.exit(2); }
const { tasks } = JSON.parse(readFileSync("evals/ab/tasks.json", "utf8"));
const REVIEWERS = 2;
const PLANS = [["A", "sonnet"], ["A", "haiku"], ["B", "sonnet"], ["B", "haiku"]];

// Small seeded generator, so the order is the same on every run.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h |= 0; h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const key = {};
for (const task of tasks) for (let j = 1; j <= REVIEWERS; j++) {
  const next = rng(`${task.id}/${j}`);
  const order = [...PLANS];
  for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(next() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
  const dir = join(packets, `${task.id}-j${j}`);
  mkdirSync(dir, { recursive: true });
  key[`${task.id}-j${j}`] = {};
  order.forEach(([arm, model], i) => {
    const text = readFileSync(join(out, `${arm}-${task.id}-${model}.task.md`), "utf8").replace(/Agent\s?Raman|\bRaman\b/gi, "the planner");
    writeFileSync(join(dir, `P${i + 1}.md`), text);
    key[`${task.id}-j${j}`][`P${i + 1}`] = `${arm}-${model}`;
  });
}
writeFileSync(join(out, "judge-key.json"), JSON.stringify(key, null, 1));
console.log(`wrote ${Object.keys(key).length} packets to ${packets}`);
