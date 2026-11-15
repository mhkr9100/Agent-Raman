// With/without test, step 4: turn the reviewers' scores into tables.
//   node evals/ab/aggregate.mjs <reviewer output .json> [results dir = evals/results/ab]
// Input: the review workflow's output (an array of packets, or an object with that array under "result"). Each
// packet holds four plans P1 to P4; evals/results/ab/judge-key.json says which arm and model wrote each one.
// Writes judgements.json (the raw reviews, kept) and scores.json (the tables), and prints the tables.
// Arm A = no Raman. Arm B = planned with Raman. Two planner models, six tasks, two reviewers per task.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [file, out = "evals/results/ab"] = process.argv.slice(2);
if (!file) { console.error("usage: node evals/ab/aggregate.mjs <reviewer output .json> [results dir]"); process.exit(2); }
const raw = JSON.parse(readFileSync(file, "utf8"));
const packets = (Array.isArray(raw) ? raw : raw.result).filter(Boolean);
const key = JSON.parse(readFileSync(join(out, "judge-key.json"), "utf8"));
writeFileSync(join(out, "judgements.json"), JSON.stringify(packets, null, 1));

// One row per (task, reviewer, plan).
const rows = [];
for (const p of packets) {
  const [, task, reviewer] = /^(.*)-j(\d)$/.exec(p.packet);
  const rank = new Map((p.ranking ?? []).map((id, i) => [id, i + 1]));
  for (const plan of p.plans) {
    const [arm, model] = key[p.packet][plan.id].split("-");
    const req = plan.requirements ?? [];
    const tools = plan.tools ?? [];
    const claims = plan.risky_claims ?? [];
    rows.push({
      task, reviewer, arm, model,
      overall: plan.overall, executability: plan.executability, concision: plan.concision, honesty: plan.honesty,
      req_total: req.length, req_yes: req.filter((r) => r.verdict === "yes").length, req_partly: req.filter((r) => r.verdict === "partly").length, req_no: req.filter((r) => r.verdict === "no").length,
      tools: tools.length, tools_missing: tools.filter((t) => t.exists === "no").length, tools_unverified: tools.filter((t) => t.exists === "unverified").length,
      tools_fit: tools.filter((t) => t.fits === "yes").length, tools_misfit: tools.filter((t) => t.fits === "no").length,
      claims: claims.length, claims_wrong: claims.filter((c) => c.verdict === "wrong").length,
      cadence: plan.cadence, trap: plan.trap, rank: rank.get(plan.id) ?? null,
    });
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (x, d = 2) => (x === null || x === undefined ? "-" : x.toFixed(d));
const sum = (g, k) => g.reduce((n, r) => n + r[k], 0);
const groups = [["A", "sonnet"], ["B", "sonnet"], ["A", "haiku"], ["B", "haiku"]];
const pick = (arm, model, task) => rows.filter((r) => r.arm === arm && r.model === model && (!task || r.task === task));

const table = groups.map(([arm, model]) => {
  const g = pick(arm, model);
  return {
    arm, model, reviews: g.length,
    overall: mean(g.map((r) => r.overall)), executability: mean(g.map((r) => r.executability)), concision: mean(g.map((r) => r.concision)), honesty: mean(g.map((r) => r.honesty)),
    // Requirement score: yes = 1, partly = 0.5, no = 0, over all requirement verdicts.
    requirements: (sum(g, "req_yes") + 0.5 * sum(g, "req_partly")) / sum(g, "req_total"),
    req_no: sum(g, "req_no"), req_partly: sum(g, "req_partly"), req_total: sum(g, "req_total"),
    tools: sum(g, "tools"), tools_missing: sum(g, "tools_missing"), tools_unverified: sum(g, "tools_unverified"), tools_misfit: sum(g, "tools_misfit"),
    tools_fit_rate: sum(g, "tools_fit") / Math.max(1, sum(g, "tools")),
    claims: sum(g, "claims"), claims_wrong: sum(g, "claims_wrong"),
    mean_rank: mean(g.filter((r) => r.rank).map((r) => r.rank)), first_places: g.filter((r) => r.rank === 1).length,
    cadence_not_ok: g.filter((r) => r.cadence === "weak" || r.cadence === "missing").length,
  };
});

// Paired: same task, same model, same reviewer, B minus A.
const pairs = [];
for (const b of rows.filter((r) => r.arm === "B")) {
  const a = rows.find((r) => r.arm === "A" && r.task === b.task && r.model === b.model && r.reviewer === b.reviewer);
  if (a) pairs.push({ task: b.task, model: b.model, reviewer: b.reviewer, a: a.overall, b: b.overall, diff: b.overall - a.overall, rank_a: a.rank, rank_b: b.rank });
}
const paired = ["sonnet", "haiku"].map((model) => {
  const g = pairs.filter((p) => p.model === model);
  return { model, pairs: g.length, mean_diff: mean(g.map((p) => p.diff)), b_wins: g.filter((p) => p.diff > 0).length, ties: g.filter((p) => p.diff === 0).length, a_wins: g.filter((p) => p.diff < 0).length };
});
const tasks = [...new Set(rows.map((r) => r.task))].sort();
const perTask = tasks.map((task) => ({ task, ...Object.fromEntries(groups.map(([arm, model]) => [`${arm}-${model}`, mean(pick(arm, model, task).map((r) => r.overall))])) }));

// Do the two reviewers agree? Same plan, two scores.
const both = [];
for (const r of rows.filter((x) => x.reviewer === "1")) {
  const o = rows.find((x) => x.reviewer === "2" && x.task === r.task && x.arm === r.arm && x.model === r.model);
  if (o) both.push([r.overall, o.overall]);
}
const mx = mean(both.map((p) => p[0])), my = mean(both.map((p) => p[1]));
const cov = both.reduce((n, [x, y]) => n + (x - mx) * (y - my), 0);
const corr = cov / Math.sqrt(both.reduce((n, [x]) => n + (x - mx) ** 2, 0) * both.reduce((n, [, y]) => n + (y - my) ** 2, 0));
const sameWinner = tasks.flatMap((task) => ["sonnet", "haiku"].map((model) => {
  const d = ["1", "2"].map((j) => pairs.find((p) => p.task === task && p.model === model && p.reviewer === j)?.diff ?? 0);
  return Math.sign(d[0]) === Math.sign(d[1]);
}));
const agreement = { plans_scored_twice: both.length, mean_abs_gap: mean(both.map(([x, y]) => Math.abs(x - y))), correlation: corr, same_winner: sameWinner.filter(Boolean).length, comparisons: sameWinner.length };

const trap = rows.filter((r) => r.task.startsWith("t4")).map((r) => ({ arm: r.arm, model: r.model, reviewer: r.reviewer, trap: r.trap }));
writeFileSync(join(out, "scores.json"), JSON.stringify({ table, paired, perTask, agreement, trap, pairs }, null, 1));

const pad = (s, n) => String(s).padEnd(n);
console.log("Scores per arm and planner model (12 reviews each: 6 tasks x 2 reviewers)");
console.log(pad("arm", 10), pad("overall/10", 11), pad("exec/5", 7), pad("concise/5", 10), pad("honest/2", 9), pad("requirements", 13), pad("rank", 6), pad("1st", 4), pad("tools", 6), pad("missing", 8), pad("misfit", 7), pad("claims", 7), "wrong");
for (const t of table) console.log(pad(`${t.arm} ${t.model}`, 10), pad(f(t.overall), 11), pad(f(t.executability), 7), pad(f(t.concision), 10), pad(f(t.honesty), 9), pad(`${f(100 * t.requirements, 0)}% (${t.req_no} no)`, 13), pad(f(t.mean_rank), 6), pad(t.first_places, 4), pad(t.tools, 6), pad(t.tools_missing, 8), pad(t.tools_misfit, 7), pad(t.claims, 7), t.claims_wrong);
console.log("\nSame task, model and reviewer: overall with Raman minus overall without");
for (const p of paired) console.log(pad(p.model, 8), `mean ${p.mean_diff >= 0 ? "+" : ""}${f(p.mean_diff)}   Raman better ${p.b_wins}, tie ${p.ties}, Raman worse ${p.a_wins}   (of ${p.pairs})`);
console.log("\nMean overall per task");
console.log(pad("task", 24), ...groups.map(([a, m]) => pad(`${a} ${m}`, 10)));
for (const t of perTask) console.log(pad(t.task, 24), ...groups.map(([a, m]) => pad(f(t[`${a}-${m}`], 1), 10)));
console.log("\nMade-up product (t4):", trap.map((t) => `${t.arm} ${t.model} j${t.reviewer}=${t.trap}`).join(", "));
console.log(`\nReviewer agreement: ${agreement.plans_scored_twice} plans scored twice, mean gap ${f(agreement.mean_abs_gap)} points, correlation ${f(agreement.correlation)}, same winner in ${agreement.same_winner} of ${agreement.comparisons} with/without comparisons`);
