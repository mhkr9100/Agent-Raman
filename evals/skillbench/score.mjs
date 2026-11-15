// PM skill pilot, step 4: tables and the rules fixed in PM-PILOT.md.
//   node evals/skillbench/score.mjs <reviews.json> <work dir>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [file, work] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(file, "utf8"));
const packets = (Array.isArray(raw) ? raw : raw.result).filter(Boolean);
const key = JSON.parse(readFileSync(join(work, "key.json"), "utf8"));
const ARMS = ["N", "S1", "S2", "S3"];
const NAME = { N: "no skill", S1: "official write-spec", S2: "prd (most installed)", S3: "product-manager" };
const rows = [];
const prefs = { S1: 0, S2: 0, S3: 0 };
for (const p of packets) {
  const arm = (id) => key[p.packet][id];
  const rank = Object.fromEntries((p.ranking ?? []).map((id, i) => [arm(id), i + 1]));
  for (const a of ["S1", "S2", "S3"]) if (rank[a] && rank.N && rank[a] < rank.N) prefs[a]++;
  for (const v of p.specs ?? []) {
    const req = v.requirements ?? [];
    rows.push({ packet: p.packet, arm: arm(v.id), overall: v.overall, engineer: v.engineer, stakeholder: v.stakeholder, concise: v.concision,
      req: req.reduce((n, r) => n + (r.verdict === "yes" ? 1 : r.verdict === "partly" ? 0.5 : 0), 0) / Math.max(1, req.length), invented: (v.invented_facts ?? []).length, rank: rank[arm(v.id)] });
  }
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const f = (x, d = 2) => x.toFixed(d);
const metrics = JSON.parse(readFileSync(join(work, "metrics.json"), "utf8"));
const table = ARMS.map((a) => {
  const g = rows.filter((r) => r.arm === a), m = metrics.filter((x) => x.arm === a);
  return { arm: a, name: NAME[a], n: g.length, overall: mean(g.map((r) => r.overall)), req: mean(g.map((r) => r.req)), engineer: mean(g.map((r) => r.engineer)), stakeholder: mean(g.map((r) => r.stakeholder)), concise: mean(g.map((r) => r.concise)), invented: mean(g.map((r) => r.invented)), rank: mean(g.map((r) => r.rank)), first: g.filter((r) => r.rank === 1).length, chars: mean(m.map((x) => x.chars)), cost_index: mean(m.map((x) => x.cost_index)), beats_N: prefs[a] ?? null };
});
console.log(`reviews: ${packets.length} of 8\n`);
console.log("arm  skill                   overall  req met  engineer  stakeholder  concise  invented  rank  1st  beats N  chars   cost idx");
for (const t of table) console.log(`${t.arm.padEnd(4)} ${t.name.padEnd(23)} ${f(t.overall).padEnd(8)} ${(f(100 * t.req, 0) + "%").padEnd(8)} ${f(t.engineer).padEnd(9)} ${f(t.stakeholder).padEnd(12)} ${f(t.concise).padEnd(8)} ${f(t.invented).padEnd(9)} ${f(t.rank).padEnd(5)} ${String(t.first).padEnd(4)} ${String(t.beats_N ?? "-").padEnd(8)} ${f(t.chars, 0).padEnd(7)} ${f(t.cost_index, 0)}`);
console.log("\nper task, mean overall N/S1/S2/S3");
for (const id of [...new Set(rows.map((r) => r.packet.replace(/-j\d$/, "")))]) console.log(id.padEnd(24), ARMS.map((a) => f(mean(rows.filter((r) => r.arm === a && r.packet.startsWith(id)).map((r) => r.overall)), 1)).join(" / "));
const N = table[0], skills = table.slice(1);
console.log("\nRules (fixed before the run)");
for (const s of skills) console.log(` ${s.arm} helps: +${f(s.overall - N.overall)} over N (needs +1.0), preferred over N in ${s.beats_N} of 8 (needs 6) -> ${s.overall - N.overall >= 1 && s.beats_N >= 6 ? "YES" : "no"}`);
const best = Math.max(...skills.map((s) => s.overall)), worst = Math.min(...skills.map((s) => s.overall));
console.log(` skills differ: best ${f(best)} - worst ${f(worst)} = ${f(best - worst)} (needs 1.5) -> ${best - worst >= 1.5 ? "YES" : "no"}`);
console.log(` popularity predicts quality (S2 installs > S3): S2 ${f(skills[1].overall)} vs S3 ${f(skills[2].overall)} -> ${skills[1].overall > skills[2].overall ? "yes" : "no"}`);
writeFileSync(join(work, "scores.json"), JSON.stringify({ table, rows }, null, 1));
