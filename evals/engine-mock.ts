// Engine test with a scripted model (RAMAN-TASK R7 gate). No LLM key needed.
//   npm run test:engine
// The model is a mock routed by the tag on the first line of each system prompt; the catalog, the embeddings,
// the binder's retrieval and every code rule are real. Runs are stored with source "eval" and deleted at the end.
import { MockLanguageModelV4 } from "ai/test";
import { answerDecisions, createRun, runToEnd, step, type EngineDeps } from "../src/lib/prism/engine";
import { indexLines } from "../src/lib/prism/render";
import { deleteRun, loadNodes, loadRun } from "../src/lib/prism/store";
import { embedQuery, serverDb } from "../src/lib/supabase-server";

import { calls, PLANTED_KEY, REQUEST, script, type Route } from "./mock-script";

function mockModel(route: Route) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const system = options.prompt.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const user = options.prompt.filter((m) => m.role === "user").flatMap((m) => m.content).map((p) => (p.type === "text" ? p.text : "")).join("\n");
      const text = JSON.stringify(route(system, user));
      return {
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: { inputTokens: { total: Math.ceil((system.length + user.length) / 4), noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: Math.ceil(text.length / 4), text: undefined, reasoning: undefined } },
        warnings: [],
      };
    },
  });
}

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
};

async function main() {
  const db = serverDb();
  const created: string[] = [];
  const fetched: string[] = [];
  const deps: EngineDeps = {
    db, embed: embedQuery, model: mockModel(script),
    fetchPage: async (url) => { fetched.push(url); return "Apollo API reference. Saved searches can be read with the search endpoint. Nothing here about push delivery."; },
  };
  try {
    // --- Run 1: the Apollo cadence case -------------------------------------------------------------------
    const a = await createRun(db, { request: REQUEST, executor: "claude_code", preset: "standard", model: "mock", provider: null, source: "eval" });
    created.push(a.id);
    check("secret in the request is removed before storage", a.secrets_removed === 1, `${a.secrets_removed} removed`);

    const [s1, s1b] = await Promise.all([step(deps, a.id), step(deps, a.id)]);
    check("two step calls at once: one runs, one is busy", [s1, s1b].filter((s) => s?.busy).length === 1);
    let run = (await loadRun(db, a.id))!;
    check("intake stops for decisions", run.phase === "decisions", `phase ${run.phase}`);
    check("cadence detected by code", run.beam.cadence?.toLowerCase() === "every 30 minutes", String(run.beam.cadence));
    check("scheduler decision D-sched added by rule", run.beam.decisions[0]?.id === "D-sched" && run.beam.decisions[0].source === "rule");
    check("invented span dropped (not a quote)", !run.beam.spans.some((s) => s.text.includes("not in the request")), `${run.beam.spans.length} spans`);
    check("gap pass: quoted miss accepted, invented miss rejected", run.beam.criteria.some((c) => /emailed/.test(c.text)) && !run.beam.criteria.some((c) => /Invented/.test(c.text)));
    check("a step while awaiting decisions does nothing", (await step(deps, a.id))?.awaiting === "decisions");

    await answerDecisions(db, a.id, {});
    run = (await loadRun(db, a.id))!;
    check("unanswered decision goes to the ledger as a default", run.assumptions.some((x) => x.source === "default" && x.ref === "D-sched"));

    const end = await runToEnd(deps, a.id, { maxSteps: 60 });
    run = (await loadRun(db, a.id))!;
    const nodes = await loadNodes(db, a.id);
    const leaves = nodes.filter((n) => !["split", "pending"].includes(n.status));
    check("run finishes", end.status === "done" && run.phase === "done", `${run.state.llm_calls} model calls, ${run.tokens_in + run.tokens_out} tokens, ${nodes.length} nodes`);
    if (end.status !== "done") { console.log(JSON.stringify({ end, error: run.state.error, events: run.state.events.slice(-12), calls }, null, 1)); throw new Error("run 1 did not finish"); }

    const sched = nodes.find((n) => n.runtime === "scheduled_host" && n.inputs.some((i) => i.type === "decision" && i.detail.includes("D-sched")));
    check("scheduling step exists, on scheduled_host, takes D-sched as input", !!sched, sched ? `step ${sched.key}` : "");
    const fetch = nodes.find((n) => /Fetch the new leads/.test(n.goal.text))!;
    check("recurring fetch runs on scheduled_host", fetch.runtime === "scheduled_host");
    check("no false bind for the recurring Apollo need", fetch.status !== "bound" && !nodes.some((n) => n.status === "bound" && n.runtime === "scheduled_host"), `fetch is ${fetch.status}`);
    check("hallucinated tool name dropped and noted", /Apollo Lead Webhook Pro 9000/.test(fetch.goal.note ?? ""), fetch.goal.note?.slice(0, 80) ?? "");
    check("credential input is an env var NAME", fetch.inputs.some((i) => i.env_var === "APOLLO_API_KEY"), JSON.stringify(fetch.inputs.map((i) => i.env_var)));
    const docs = nodes.find((n) => /documentation for a library/.test(n.goal.text))!;
    check("one-off documentation need is bound from the catalog", docs.status === "bound" && docs.capabilities.length >= 1, docs.capabilities.map((c) => `${c.name} (${c.role})`).join(", ") || `${docs.status}: ${docs.goal.note ?? ""}`);
    if (process.argv.includes("--debug")) console.log(JSON.stringify({ calls, events: run.state.events.map((e) => e.msg) }, null, 1));
    const { count: bindings } = await db.from("binding").select("*", { count: "exact", head: true }).eq("node_id", docs.id);
    check("binding rows written", (bindings ?? 0) >= 1, `${bindings}`);
    check("human step kept as human", nodes.some((n) => n.status === "human" && /Approve/.test(n.goal.text)));
    check("obstacle created a sibling step that went through expand", nodes.some((n) => n.trace.includes("inferred:rule:obstacle") && n.status !== "pending"));

    check("critic: hallucinated webhook is in the ledger", run.assumptions.some((x) => x.source === "critic_unverified" && /webhook/i.test(x.text)));
    check("critic: hallucinated webhook is NOT in the tree", !nodes.some((n) => /webhook/i.test(n.goal.text)));
    check("critic: page was fetched through the injected fetcher only", fetched.length >= 1 && fetched.every((u) => u.includes("apollo.example.com")), `${fetched.length} fetch(es)`);
    check("critic: no-evidence proposal rejected", !nodes.some((n) => /vector database/i.test(n.goal.text)) && run.state.critic_log.some((l) => l.rule === "no_evidence"));
    const logNode = nodes.find((n) => n.trace.includes("inferred:critic:r1"));
    check("critic: quoted gap accepted and expanded", !!logNode && logNode.status === "build" && run.beam.criteria.some((c) => c.source === "critic"), logNode ? `step ${logNode.key} [${logNode.status}]` : "");
    check("critic: Chapman estimate recorded", !!run.state.chapman && run.state.chapman.m === 1, JSON.stringify(run.state.chapman));
    check("critic stops by saturation or limit", run.state.critic_rounds >= 2 && run.state.critic_rounds <= 3, `${run.state.critic_rounds} rounds, added ${JSON.stringify(run.state.critic_added)}`);
    check("every leaf has a self-evaluation with gates", leaves.every((l) => l.self_eval && Object.keys(l.self_eval.gates).length > 0));

    const md = run.task_md ?? "";
    for (const h of ["## 0. Header", "## 1. Confirm before starting", "## 2. Assumptions ledger", "## 3. System prompt", "## 5. Capabilities BoM", "## 6. Runbook", "## 7. Checks", "## 9. Open questions", "## 10. Report-back", "## 11. Coverage appendix", "## Appendix A. Step cards"])
      check(`task.md has "${h}"`, md.includes(h));
    check("task.md asks the scheduler decision", /\| D-sched \|/.test(md));
    const bomRows = md.split("## 5. Capabilities BoM")[1].split("\n## ")[0].split("\n").filter((l) => /^\| B\d+ \|/.test(l));
    check("BoM has rows and every row has an invoke-when", bomRows.length >= 1 && bomRows.every((r) => (r.split("|")[7] ?? "").trim().length > 3), `${bomRows.length} row(s)`);
    check("task.md holds no key-like string", !md.includes(PLANTED_KEY) && !/sk-[A-Za-z0-9_-]{16,}/.test(md));
    check("task.md index is under 200 lines", indexLines(md) < 200, `${indexLines(md)} lines before Appendix A, ${md.split("\n").length} in total`);
    check("coverage stored", run.coverage.criteria_total >= 4 && run.coverage.criteria_traced >= 1, `${run.coverage.criteria_traced}/${run.coverage.criteria_total} criteria traced`);
    const { data: raw } = await db.from("run").select("request_text,request_embedding").eq("id", a.id).single();
    check("request text dropped at the end (keep_text off)", run.beam.request === "" && raw?.request_text === null && raw?.request_embedding !== null);
    check("stored state holds no key-like string", !JSON.stringify([run.beam, run.state, run.assumptions, nodes]).includes(PLANTED_KEY));

    // --- Run 2: same request again → seed + diff (R10) ----------------------------------------------------
    Object.keys(calls).forEach((k) => delete calls[k]);
    const b = await createRun(db, { request: REQUEST, executor: "claude_code", preset: "quick", model: "mock", provider: null, source: "eval" });
    created.push(b.id);
    await runToEnd(deps, b.id, { maxSteps: 60, autoDecide: true });
    const run2 = (await loadRun(db, b.id))!;
    check("second run: seeded from the first (Spectral Library)", run2.state.seed?.run_id === a.id, `similarity ${run2.state.seed?.similarity.toFixed(3)}`);
    check("second run: diff against the first", run2.state.diff?.previous_run === a.id && (run2.task_md ?? "").includes("Compared with your previous run"), JSON.stringify(run2.state.diff && { added: run2.state.diff.added.length, removed: run2.state.diff.removed.length, kept: run2.state.diff.kept }));
    check("quick preset: one framing, one critic round at most", run2.state.critic_rounds <= 1 && !run2.state.chapman);

    // --- Run 3: provider keeps failing → run fails after three steps, error redacted -----------------------
    const c = await createRun(db, { request: "Summarise the open pull requests of one repository into a weekly note.", executor: "codex", preset: "quick", model: "mock", provider: null, source: "eval" });
    created.push(c.id);
    const broken: EngineDeps = { ...deps, model: mockModel(() => { throw new Error(`401 invalid key ${PLANTED_KEY}`); }) };
    const r1 = await step(broken, c.id), r2 = await step(broken, c.id), r3 = await step(broken, c.id);
    check("failed step keeps the phase so the client can retry", r1?.status === "running" && r1.phase === "intake" && r2?.status === "running");
    check("three failed steps in a row fail the run", r3?.status === "failed");
    check("stored error is redacted", !!r3?.error && !r3.error.includes(PLANTED_KEY), r3?.error ?? "");

    // --- Run 4: token budget -----------------------------------------------------------------------------
    const d = await createRun(db, { request: REQUEST, executor: "claude_code", preset: "quick", model: "mock", provider: null, source: "eval" });
    created.push(d.id);
    await step(deps, d.id);
    await answerDecisions(db, d.id, { "D-sched": "A CI scheduler (for example a scheduled workflow in the repo's CI)" });
    await step(deps, d.id); // root split
    await db.from("run").update({ token_budget: 1 }).eq("id", d.id);
    await runToEnd(deps, d.id, { maxSteps: 20 });
    const run4 = (await loadRun(db, d.id))!;
    const nodes4 = await loadNodes(db, d.id);
    check("budget stop: run still ends with a task.md", run4.status === "done" && !!run4.task_md);
    check("budget stop: open needs are unresolved with owner budget", nodes4.some((n) => n.status === "unresolved" && n.goal.owner === "budget") && (run4.task_md ?? "").includes("budget"));
    check("answered decision is used", run4.beam.decisions[0].answer?.startsWith("A CI scheduler") === true && nodes4.some((n) => n.inputs.some((i) => i.detail.includes("A CI scheduler"))));

    if (process.argv.includes("--print")) console.log(`\n${"-".repeat(100)}\n${md}`);
  } finally {
    for (const id of created) await deleteRun(db, id).catch((e) => console.log(`cleanup ${id}: ${e.message}`));
    console.log(`\ncleaned up ${created.length} eval run(s)`);
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
