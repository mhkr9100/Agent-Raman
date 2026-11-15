// With/without test, step 2: collect what the test agents produced and what they cost.
//   node evals/ab/collect.mjs <workflow transcript dir> [results dir = evals/results/ab] [plan arms = A]
// "plan arms": the arms whose final reply is the plan itself (comma list). The checker test uses V1,V2.
// Reads the workflow journal (label and final reply of every agent) and each agent transcript (token usage per
// model call, tool calls, times). Writes A-*.task.md (arm A replies are the plan itself), B-*.reply.txt (arm B
// replies are a short note; its plan and task.md were saved by the server), and metrics.json.
// Cost is reported as tokens and as an index, not dollars: index = input + 1.25 x cache write + 0.1 x cache read
// + 5 x output. The weights are an assumption about the usual price ratios, stated so the reader can change them.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [dir, out = "evals/results/ab", planArms = "A"] = process.argv.slice(2);
const isPlan = new Set(planArms.split(","));
if (!dir) { console.error("usage: node evals/ab/collect.mjs <workflow transcript dir> [results dir]"); process.exit(2); }
const lines = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const journal = lines(join(dir, "journal.jsonl"));
const label = new Map(journal.filter((l) => l.type === "started").map((l) => [l.agentId, l.label]));
const calls = existsSync(join(out, "calls.jsonl")) ? lines(join(out, "calls.jsonl")) : [];
const metrics = [];

for (const r of journal.filter((l) => l.type === "result")) {
  const name = label.get(r.agentId);
  if (!name) continue;
  const [arm, ...rest] = name.split("-");
  const model = rest.pop();
  const task = rest.join("-");
  const text = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
  writeFileSync(join(out, isPlan.has(arm) ? `${name}.task.md` : `${name}.reply.txt`), text);

  const t = lines(join(dir, `agent-${r.agentId}.jsonl`));
  const perRequest = new Map(); // one model call can span several transcript lines: keep its last usage
  const tools = {};
  for (const l of t) {
    if (l.type !== "assistant" || !l.message) continue;
    if (l.message.usage) perRequest.set(l.requestId ?? l.uuid, l.message.usage);
    for (const b of Array.isArray(l.message.content) ? l.message.content : []) if (b.type === "tool_use") tools[b.name] = (tools[b.name] ?? 0) + 1;
  }
  const sum = (k) => [...perRequest.values()].reduce((n, u) => n + (u[k] ?? 0), 0);
  const times = t.map((l) => Date.parse(l.timestamp)).filter(Number.isFinite);
  const u = { input: sum("input_tokens"), cache_write: sum("cache_creation_input_tokens"), cache_read: sum("cache_read_input_tokens"), output: sum("output_tokens") };
  const mine = calls.filter((c) => c.run === name);
  const file = join(out, `${name}.task.md`);
  metrics.push({
    label: name, arm, task, model,
    model_calls: perRequest.size,
    ...u,
    cost_index: Math.round(u.input + 1.25 * u.cache_write + 0.1 * u.cache_read + 5 * u.output),
    tool_calls: Object.values(tools).reduce((a, b) => a + b, 0),
    tools,
    seconds: times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : null,
    task_md_chars: existsSync(file) ? readFileSync(file, "utf8").length : 0,
    raman: arm === "B" || mine.length ? {
      calls: mine.length,
      by_tool: mine.reduce((m, c) => ((m[c.tool] = (m[c.tool] ?? 0) + 1), m), {}),
      failed_checks: mine.filter((c) => c.tool === "check" && c.ok === false).length,
      errors: mine.filter((c) => c.error).length,
      server_ms: mine.reduce((n, c) => n + c.ms, 0),
      rendered: mine.some((c) => c.tool === "render" && c.ok !== false && !c.error),
    } : null,
  });
}

metrics.sort((a, b) => a.task.localeCompare(b.task) || a.model.localeCompare(b.model) || a.arm.localeCompare(b.arm));
writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 1));

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("run", 34), pad("calls", 6), pad("in+cache", 10), pad("output", 8), pad("index", 9), pad("tools", 6), pad("sec", 5), pad("md chars", 9), "raman calls");
for (const m of metrics) console.log(pad(m.label, 34), pad(m.model_calls, 6), pad(m.input + m.cache_write + m.cache_read, 10), pad(m.output, 8), pad(m.cost_index, 9), pad(m.tool_calls, 6), pad(m.seconds, 5), pad(m.task_md_chars, 9), m.raman ? `${m.raman.calls} (${m.raman.failed_checks} failed checks, ${m.raman.errors} errors)${m.raman.rendered ? "" : " NOT RENDERED"}` : "");

const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
for (const model of [...new Set(metrics.map((m) => m.model))]) for (const arm of [...new Set(metrics.map((m) => m.arm))].sort()) {
  const g = metrics.filter((m) => m.model === model && m.arm === arm);
  console.log(`mean ${arm} ${model}: index ${mean(g.map((m) => m.cost_index))}, output ${mean(g.map((m) => m.output))}, tool calls ${mean(g.map((m) => m.tool_calls))}, seconds ${mean(g.map((m) => m.seconds))}, md chars ${mean(g.map((m) => m.task_md_chars))}`);
}
