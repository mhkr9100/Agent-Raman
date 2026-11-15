// Checker test, step 4: turn the reviews into tables and apply the stop rule (design: evals/ab/CHECK-TEST.md).
//   node evals/ab/check-aggregate.mjs <reviewer output .json> [results = evals/results/check] [first-test results = evals/results/ab]
// Input: the review workflow's output (an array of packets, or an object with that array under "result"). Each
// packet holds one claim table and three versions X1 to X3; judge-key.json says which arm each one is.
// Arms: O = original plan, V1 = one-line pass (verify on the web), V2 = the same line plus the AgentRamaN check.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [file, out = "evals/results/check", first = "evals/results/ab"] = process.argv.slice(2);
if (!file) { console.error("usage: node evals/ab/check-aggregate.mjs <reviewer output .json> [results] [first-test results]"); process.exit(2); }
const raw = JSON.parse(readFileSync(file, "utf8"));
const packets = (Array.isArray(raw) ? raw : raw.result).filter(Boolean);
const key = JSON.parse(readFileSync(join(out, "judge-key.json"), "utf8"));
writeFileSync(join(out, "judgements.json"), JSON.stringify(packets, null, 1));

const ARMS = ["O", "V1", "V2"];
const VERDICTS = ["correct", "wrong", "unverified", "flagged", "absent"];
const zero = () => Object.fromEntries(VERDICTS.map((v) => [v, 0]));
const claims = Object.fromEntries(ARMS.map((a) => [a, zero()]));
const known = Object.fromEntries(ARMS.map((a) => [a, zero()]));
const rows = [];
const perPlan = [];

for (const p of packets) {
  const arm = (x) => key[p.packet][x];
  const wrong = { O: 0, V1: 0, V2: 0 };
  for (const c of p.claims ?? []) for (const x of ["X1", "X2", "X3"]) {
    const v = VERDICTS.includes(c[x]) ? c[x] : "unverified";
    claims[arm(x)][v]++;
    if (c.known_fault) known[arm(x)][v]++;
    if (v === "wrong") wrong[arm(x)]++;
  }
  const rank = Object.fromEntries((p.ranking ?? []).map((x, i) => [arm(x), i + 1]));
  const score = {};
  for (const v of p.versions ?? []) {
    const req = v.requirements ?? [];
    score[arm(v.id)] = v.overall;
    rows.push({ packet: p.packet, model: p.packet.split("-").pop(), arm: arm(v.id), overall: v.overall, executability: v.executability, concision: v.concision, honesty: v.honesty,
      req_total: req.length, req_yes: req.filter((r) => r.verdict === "yes").length, tools_missing: (v.tools_missing ?? []).length, rank: rank[arm(v.id)] ?? null });
  }
  perPlan.push({ packet: p.packet, claims: (p.claims ?? []).length, wrong, score, rank });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (x, d = 2) => (x === null || x === undefined ? "-" : x.toFixed(d));
const pad = (s, n) => String(s).padEnd(n);

console.log(`\nReviews: ${packets.length} of 12. Claims in the shared tables: ${perPlan.reduce((n, r) => n + r.claims, 0)}`);
console.log("\nClaims per arm (same claim tables)");
console.log(pad("arm", 5), ...VERDICTS.map((v) => pad(v, 11)));
for (const a of ARMS) console.log(pad(a, 5), ...VERDICTS.map((v) => pad(claims[a][v], 11)));
console.log("\nOf the faults the first test found in the originals");
console.log(pad("arm", 5), ...VERDICTS.map((v) => pad(v, 11)));
for (const a of ARMS) console.log(pad(a, 5), ...VERDICTS.map((v) => pad(known[a][v], 11)));

console.log("\nScores (mean over plans)");
console.log(pad("arm", 12), pad("overall", 9), pad("exec", 6), pad("concise", 9), pad("honest", 8), pad("req met", 9), pad("rank", 6), pad("1st", 5), "tools missing");
const scoreTable = [];
for (const model of ["all", "sonnet", "haiku"]) for (const a of ARMS) {
  const g = rows.filter((r) => r.arm === a && (model === "all" || r.model === model));
  if (!g.length) continue;
  const t = { arm: a, model, n: g.length, overall: mean(g.map((r) => r.overall)), executability: mean(g.map((r) => r.executability)), concision: mean(g.map((r) => r.concision)), honesty: mean(g.map((r) => r.honesty)),
    req_met: g.reduce((n, r) => n + r.req_yes, 0) / Math.max(1, g.reduce((n, r) => n + r.req_total, 0)), rank: mean(g.map((r) => r.rank).filter(Boolean)), first: g.filter((r) => r.rank === 1).length, tools_missing: g.reduce((n, r) => n + r.tools_missing, 0) };
  scoreTable.push(t);
  console.log(pad(`${a} ${model}`, 12), pad(f(t.overall), 9), pad(f(t.executability), 6), pad(f(t.concision), 9), pad(f(t.honesty), 8), pad(f(100 * t.req_met, 0) + "%", 9), pad(f(t.rank), 6), pad(t.first, 5), t.tools_missing);
}

console.log("\nPer plan: wrong claims O/V1/V2, overall O/V1/V2, rank O/V1/V2");
for (const r of perPlan) console.log(pad(r.packet, 30), pad(ARMS.map((a) => r.wrong[a]).join("/"), 9), pad(ARMS.map((a) => r.score[a] ?? "-").join("/"), 10), ARMS.map((a) => r.rank[a] ?? "-").join("/"));

// Cost of the second pass, next to what the original plan cost to write.
let cost = null;
if (existsSync(join(out, "metrics.json"))) {
  const m = JSON.parse(readFileSync(join(out, "metrics.json"), "utf8"));
  const m0 = existsSync(join(first, "metrics.json")) ? JSON.parse(readFileSync(join(first, "metrics.json"), "utf8")).filter((x) => x.arm === "A") : [];
  cost = [];
  console.log("\nCost (mean per plan)");
  console.log(pad("arm", 12), pad("index", 9), pad("output", 8), pad("model calls", 12), pad("tool calls", 11), pad("seconds", 8), "chars");
  for (const model of ["sonnet", "haiku"]) for (const [a, src] of [["O (writing)", m0], ["V1", m], ["V2", m]]) {
    const g = src.filter((x) => x.model === model && (a.startsWith("O") ? true : x.arm === a));
    if (!g.length) continue;
    const t = { arm: a, model, cost_index: mean(g.map((x) => x.cost_index)), output: mean(g.map((x) => x.output)), model_calls: mean(g.map((x) => x.model_calls)), tool_calls: mean(g.map((x) => x.tool_calls)), seconds: mean(g.map((x) => x.seconds)), chars: mean(g.map((x) => x.task_md_chars)) };
    cost.push(t);
    console.log(pad(`${a} ${model}`, 20), pad(f(t.cost_index, 0), 9), pad(f(t.output, 0), 8), pad(f(t.model_calls, 1), 12), pad(f(t.tool_calls, 1), 11), pad(f(t.seconds, 0), 8), f(t.chars, 0));
  }
}

// Stop rule, as fixed in CHECK-TEST.md before the run.
const w1 = claims.V1.wrong, w2 = claims.V2.wrong;
const fewer = w1 > 0 ? (w1 - w2) / w1 : (w2 === 0 ? 0 : -1);
const above = perPlan.filter((r) => r.rank.V2 && r.rank.V1 && r.rank.V2 < r.rank.V1).length;
const all = (a) => scoreTable.find((t) => t.arm === a && t.model === "all")?.overall ?? null;
const rule = { wrong_O: claims.O.wrong, wrong_V1: w1, wrong_V2: w2, fewer_wrong_than_V1: fewer, rule1: fewer >= 0.3, v2_above_v1: above, rule2: above >= 9, overall_V1: all("V1"), overall_V2: all("V2"), rule3: all("V2") >= all("V1") };
rule.clearly_better = rule.rule1 && rule.rule2 && rule.rule3;
console.log(`\nStop rule\n 1. wrong claims O ${claims.O.wrong}, V1 ${w1}, V2 ${w2}: V2 has ${f(100 * fewer, 0)}% fewer than V1 (needs 30%) -> ${rule.rule1 ? "met" : "not met"}`);
console.log(` 2. V2 ranked above V1 in ${above} of ${perPlan.length} plans (needs 9) -> ${rule.rule2 ? "met" : "not met"}`);
console.log(` 3. mean overall V1 ${f(rule.overall_V1)}, V2 ${f(rule.overall_V2)} (V2 must not be lower) -> ${rule.rule3 ? "met" : "not met"}`);
console.log(` Result: the check ${rule.clearly_better ? "CLEARLY BEATS" : "does NOT clearly beat"} the one line.`);

writeFileSync(join(out, "scores.json"), JSON.stringify({ claims, known, scores: scoreTable, per_plan: perPlan, cost, rule }, null, 1));
