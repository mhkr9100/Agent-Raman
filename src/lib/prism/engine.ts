// Prism engine (RAMAN-TASK R7): one run moves through intake → decisions → expand → obstacles → critic →
// finalize, one bounded step per request so every step fits a serverless function. State lives in Postgres;
// the user's model is passed in per step and never stored. Raman plans; it never executes the user's task.
import { createHash } from "node:crypto";
import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { bind } from "../binder";
import type { Executor } from "../binder/types";
import { metered, newMeter, redact, type Meter } from "./ask";
import { adjudicate, chapman, propose, type FetchPage, type Framing } from "./critic";
import { expandNode, newNode, type BindingRow, type ExpandCtx } from "./expand";
import { byKey, coverageOf, leafGates, leavesOf, runGates } from "./gates";
import { intake } from "./intake";
import { mergeBom, mergeNotes } from "./merge";
import { OBSTACLE_BATCH, obstaclePass } from "./obstacles";
import { renderTaskMd } from "./render";
import { claimRun, insertBindings, insertRun, loadNodes, loadRun, releaseRun, saveRun, upsertNodes } from "./store";
import { clip, norm, scrubSecrets } from "./text";
import { PRESETS, emptyState, type Beam, type PNode, type Preset, type RunRow } from "./types";

export const LIMITS = { request: 20_000, attachments: 5, attachment: 40_000, attachmentsTotal: 80_000, expandBatch: 3, lockSeconds: 280, seedSimilarity: 0.86 };
const EXECUTORS: Executor[] = ["claude_code", "codex", "chatgpt", "cursor"];
const SUCCESS = ["bound", "build", "human"];

export interface EngineDeps {
  db: SupabaseClient;
  embed: (texts: string[]) => Promise<number[][]>;
  /** Built from the user's key for this request only. */
  model: LanguageModel;
  bindFn?: typeof bind;
  fetchPage?: FetchPage;
}

export interface CreateInput {
  request: string;
  attachments?: { name: string; text: string }[];
  executor: Executor;
  preset: Preset;
  model: string;
  provider: string | null;
  source?: "web" | "mcp" | "eval";
  keep_text?: boolean;
}

export class InputError extends Error {}

export const requestHash = (request: string, executor: string) => createHash("sha256").update(`${norm(request)}\n${executor}`).digest("hex");

/** Creates the run row. No LLM call: the first step does the intake. Secrets pasted in the request are removed first. */
export async function createRun(db: SupabaseClient, input: CreateInput): Promise<{ id: string; secrets_removed: number }> {
  const raw = (input.request ?? "").trim();
  if (raw.length < 10) throw new InputError("Describe the task in at least a sentence.");
  if (raw.length > LIMITS.request) throw new InputError(`The request is longer than ${LIMITS.request} characters.`);
  if (!EXECUTORS.includes(input.executor)) throw new InputError("Unknown executor.");
  if (!(input.preset in PRESETS)) throw new InputError("Unknown preset.");
  const files = input.attachments ?? [];
  if (files.length > LIMITS.attachments) throw new InputError(`At most ${LIMITS.attachments} attachments.`);
  if (files.some((a) => a.text.length > LIMITS.attachment) || files.reduce((s, a) => s + a.text.length, 0) > LIMITS.attachmentsTotal) throw new InputError("Attachments are too large.");

  let removed = 0;
  const scrub = (s: string) => { const r = scrubSecrets(s); removed += r.found; return r.text; };
  const request = scrub(raw);
  const beam: Beam = {
    request,
    attachments: files.map((a) => ({ name: clip(a.name.trim() || "attachment", 80), text: scrub(a.text) })),
    summary: "", spans: [], criteria: [], decisions: [],
    environment: { executor: input.executor, os: null, tools_present: [], notes: [] },
    out_of_scope: [], cadence: null,
  };
  const state = emptyState();
  if (removed) state.events.push({ t: new Date().toISOString(), msg: `${removed} key-like string(s) removed from the request before anything was stored` });
  const id = await insertRun(db, {
    request_hash: requestHash(request, input.executor),
    request_text: input.keep_text ? request : null,
    preset: input.preset,
    executor: input.executor,
    model: clip(input.model, 120) || "unknown",
    provider: input.provider,
    source: input.source ?? "web",
    status: "running",
    phase: "intake",
    token_budget: PRESETS[input.preset].tokenBudget,
    beam,
    state,
    keep_text: !!input.keep_text,
  });
  return { id, secrets_removed: removed };
}

export interface StepResult { status: RunRow["status"]; phase: RunRow["phase"]; awaiting: "decisions" | null; busy: boolean; error: string | null }

interface Work {
  deps: EngineDeps;
  run: RunRow;
  nodes: PNode[];
  meter: Meter;
  bindings: BindingRow[];
  extra: Record<string, unknown>;
}

const event = (run: RunRow, msg: string) => {
  run.state.events.push({ t: new Date().toISOString(), msg: clip(msg, 200) });
  if (run.state.events.length > 200) run.state.events.splice(0, run.state.events.length - 200);
};

function startTree(run: RunRow, nodes: PNode[]): void {
  const root = newNode(run.id, null, "0", { text: run.beam.summary || "The task", category: "model_instructions" });
  root.trace = run.beam.criteria.map((c) => c.id);
  root.constraints_spec.budget_tokens = run.token_budget ?? PRESETS[run.preset].tokenBudget;
  nodes.push(root);
  run.phase = "expand";
  event(run, `Tree started: ${run.beam.criteria.length} criteria to serve`);
}

/** Records the user's answers (or the defaults) and starts the tree. Defaults go to the Assumptions ledger. */
export async function answerDecisions(db: SupabaseClient, id: string, answers: Record<string, string>): Promise<StepResult | null> {
  const run = await loadRun(db, id);
  if (!run) return null;
  if (run.status !== "running" || run.phase !== "decisions") return { status: run.status, phase: run.phase, awaiting: null, busy: false, error: null };
  if (!(await claimRun(db, id, 30))) return { status: run.status, phase: run.phase, awaiting: "decisions", busy: true, error: null };
  try {
    const nodes: PNode[] = [];
    applyDecisions(run, answers);
    startTree(run, nodes);
    await upsertNodes(db, nodes);
    await saveRun(db, id, { phase: run.phase, beam: run.beam, state: run.state, assumptions: run.assumptions });
    return { status: run.status, phase: run.phase, awaiting: null, busy: false, error: null };
  } finally {
    await releaseRun(db, id);
  }
}

function applyDecisions(run: RunRow, answers: Record<string, string>): void {
  let seq = run.assumptions.length;
  for (const d of run.beam.decisions) {
    const a = scrubSecrets(clip((answers[d.id] ?? "").trim(), 300)).text;
    if (a) d.answer = a;
    else run.assumptions.push({ id: `A${++seq}`, source: "default", ref: d.id, text: clip(`${d.question} Not answered, so the plan assumes: ${d.default}. ${d.why}`, 400) });
  }
  event(run, `Decisions: ${run.beam.decisions.filter((d) => d.answer).length} answered, ${run.beam.decisions.filter((d) => !d.answer).length} left at the default`);
}

async function intakeStep(w: Work): Promise<void> {
  const { run, deps } = w;
  const beam = await intake(metered(deps.model, w.meter), {
    request: run.beam.request, attachments: run.beam.attachments, executor: run.executor, twoCuts: PRESETS[run.preset].twoCuts,
  });
  run.beam = beam;
  event(run, `Intake: ${beam.criteria.length} criteria, ${beam.decisions.length} decision(s)${beam.cadence ? `, cadence "${beam.cadence}"` : ""}`);

  // Spectral Library (R10): the nearest finished run is a hint for the root split. Its items are re-bound, never trusted.
  try {
    const [vec] = await deps.embed([clip(beam.request, 2000)]);
    w.extra.request_embedding = JSON.stringify(vec);
    const { data } = await deps.db.rpc("similar_runs", { p_embedding: JSON.stringify(vec), p_exclude: run.id, p_limit: 3 });
    const near = ((data ?? []) as { id: string; similarity: number; executor: string; state: RunRow["state"] }[])
      .find((r) => r.similarity >= LIMITS.seedSimilarity && r.executor === run.executor && r.state?.summary);
    if (near?.state.summary) {
      run.state.seed = { run_id: near.id, similarity: near.similarity, outline: near.state.summary.outline.slice(0, 40), items: near.state.summary.items.slice(0, 30) };
      event(run, `Spectral Library: a similar finished run (similarity ${near.similarity.toFixed(2)}) seeds the first split`);
    }
  } catch (e) {
    event(run, `Spectral Library lookup skipped: ${redact(e)}`);
  }

  if (beam.decisions.length) run.phase = "decisions";
  else startTree(run, w.nodes);
}

function stopPending(w: Work, owner: string, why: string): number {
  const pending = w.nodes.filter((n) => n.status === "pending");
  for (const n of pending) {
    n.status = "unresolved";
    n.goal.owner = owner;
    n.goal.note = [n.goal.note, why].filter(Boolean).join(" ");
    n.dirty = true;
  }
  return pending.length;
}

async function expandStep(w: Work): Promise<void> {
  const { run, deps, nodes } = w;
  const pending = nodes.filter((n) => n.status === "pending").sort((a, b) => a.depth - b.depth || byKey(a, b)).slice(0, LIMITS.expandBatch);
  if (!pending.length) { run.phase = "obstacles"; return; }

  const ctx: ExpandCtx = { db: deps.db, embed: deps.embed, model: deps.model, run: { id: run.id, executor: run.executor, preset: run.preset }, beam: run.beam, state: run.state, nodeCount: nodes.length, bindFn: deps.bindFn };
  const results = await Promise.all(pending.map(async (n) => {
    const m = newMeter();
    try {
      const r = await expandNode(ctx, metered(deps.model, m), n);
      return { n, m, r, err: null as string | null };
    } catch (e) {
      return { n, m, r: null, err: redact(e) };
    }
  }));

  for (const { n, m, r, err } of results) {
    w.meter.in += m.in; w.meter.out += m.out; w.meter.calls += m.calls;
    n.tokens_used += m.in + m.out;
    n.dirty = true;
    if (r) {
      nodes.push(...r.children);
      w.bindings.push(...r.bindings);
      for (const e of r.events) event(run, e);
    }
    if (err && n.key !== "0") {
      n.goal.attempts += 1;
      if (n.goal.attempts >= 2) {
        n.status = "unresolved";
        n.goal.owner = "raman";
        n.goal.note = clip(`Raman could not work on this need (two failed attempts): ${err}`, 300);
        event(run, `${n.key} unresolved after two failed attempts`);
      } else event(run, `${n.key} failed once, will retry`);
    }
  }
  // When nothing in the batch worked (bad key, provider down), the step itself failed: the caller may retry.
  if (results.every((x) => x.err)) throw new Error(results[0].err!);
  if (!nodes.some((n) => n.status === "pending")) run.phase = "obstacles";
}

async function obstacleStep(w: Work): Promise<void> {
  const { run, nodes, deps } = w;
  const open = leavesOf(nodes).filter((l) => !l.self_eval);
  for (const l of open.filter((x) => x.status === "unresolved")) {
    l.self_eval = { confidence: 0, reason: "Unresolved: nothing to assess", obstacles: [], gates: {} };
    l.dirty = true;
  }
  const batch = open.filter((x) => x.status !== "unresolved").slice(0, OBSTACLE_BATCH);
  if (batch.length) {
    try {
      const res = await obstaclePass(metered(deps.model, w.meter), { run: { id: run.id, preset: run.preset }, beam: run.beam, state: run.state, nodes, assumptions: run.assumptions }, batch);
      nodes.push(...res.created);
      run.assumptions.push(...res.assumptions);
      for (const e of res.events) event(run, e);
      event(run, `Obstacle check: ${batch.length} step(s), ${res.created.length} new step(s), ${res.assumptions.length} ledger entr${res.assumptions.length === 1 ? "y" : "ies"}`);
    } catch (e) {
      // The check is advisory. After one failed try the batch is marked "not assessed" so the run still finishes.
      if (run.state.step_errors < 1) throw e;
      for (const l of batch) { l.self_eval = { confidence: 0.5, reason: "Not assessed: the obstacle check failed twice", obstacles: [], gates: {} }; l.dirty = true; }
      event(run, `Obstacle check failed twice for ${batch.length} step(s); marked not assessed`);
    }
  }
  if (nodes.some((n) => n.status === "pending")) run.phase = "expand";
  else if (!leavesOf(nodes).some((l) => !l.self_eval)) run.phase = "critic";
}

async function criticStep(w: Work): Promise<void> {
  const { run, nodes, deps } = w;
  const st = run.state;
  const cfg = PRESETS[run.preset];
  // Close the books on the previous round: how many of its additions ended as a usable step?
  while (st.critic_added.length < st.critic_rounds) {
    const r = st.critic_added.length + 1;
    st.critic_added.push(leavesOf(nodes).filter((n) => n.trace.includes(`inferred:critic:r${r}`) && SUCCESS.includes(n.status)).length);
  }
  const leaves = leavesOf(nodes);
  const need = leaves.length >= 20 ? 1 : 2;
  const saturated = st.critic_added.length >= need && st.critic_added.slice(-need).every((x) => x === 0);
  const round = st.critic_rounds + 1;
  if (round > cfg.criticRounds || saturated) {
    event(run, saturated ? `Critic stopped: ${need} round(s) added nothing` : `Critic stopped after ${st.critic_rounds} round(s) (preset limit)`);
    run.phase = "finalize";
    return;
  }

  const gate = runGates(run.beam, nodes, st);
  const framings: Framing[] = round === 1 && cfg.twoCuts ? ["auditor", "premortem"] : [cfg.twoCuts && round % 2 === 1 ? "premortem" : "auditor"];
  const model = metered(deps.model, w.meter);
  const lists = await Promise.all(framings.map((f) => propose(model, f, run.beam, nodes, gate)));
  if (lists.length === 2) st.chapman = chapman(lists[0], lists[1]);
  const adj = await adjudicate(
    { db: deps.db, run: { id: run.id }, beam: run.beam, nodes, gate, assumptions: run.assumptions, round, fetchPage: deps.fetchPage },
    lists.flatMap((l, i) => l.map((p) => ({ framing: framings[i], p }))),
  );
  nodes.push(...adj.accepted);
  run.assumptions.push(...adj.ledger);
  st.critic_log.push(...adj.log);
  st.critic_rounds = round;
  st.independence = "same model, fresh context";
  event(run, `Critic round ${round} (${framings.join(" + ")}): ${lists.flat().length} proposal(s), ${adj.accepted.length} accepted with checked evidence`);
  for (const e of adj.events) event(run, e);
  if (adj.accepted.length) run.phase = "expand";
}

async function finalizeStep(w: Work): Promise<void> {
  const { run, nodes, deps } = w;
  const st = run.state;
  stopPending(w, "raman", "Left unfinished when the run ended.");
  const leaves = leavesOf(nodes);
  for (const l of leaves) {
    l.self_eval = { ...(l.self_eval ?? { confidence: l.status === "unresolved" ? 0 : 0.5, reason: "Not assessed", obstacles: [] }), gates: leafGates(l, nodes, run.beam) };
    l.dirty = true;
  }
  const gate = runGates(run.beam, nodes, st);
  st.merge_notes = mergeNotes(run.beam, nodes);
  const bom = mergeBom(nodes);
  const coverage = coverageOf(run.beam, nodes, st, gate, bom.length);
  st.summary = {
    outline: leaves.map((l) => `${l.key} [${l.status}] ${clip(l.goal.text, 120)}`).slice(0, 60),
    items: bom.filter((m) => m.steps.length).map((m) => m.row.name),
  };

  // R10: the same request run again shows what changed.
  const { data: prev } = await deps.db.from("run").select("id,created_at,state").eq("request_hash", run.request_hash).eq("status", "done").neq("id", run.id).order("created_at", { ascending: false }).limit(1);
  const before = (prev?.[0] as { id: string; created_at: string; state: RunRow["state"] } | undefined);
  if (before?.state?.summary) {
    const old = new Set(before.state.summary.items), now = new Set(st.summary.items);
    st.diff = { previous_run: before.id, previous_at: before.created_at, added: [...now].filter((x) => !old.has(x)), removed: [...old].filter((x) => !now.has(x)), kept: [...now].filter((x) => old.has(x)).length };
  }

  const md = scrubSecrets(renderTaskMd({
    run: { id: run.id, executor: run.executor, preset: run.preset, model: run.model, created_at: run.created_at, source: run.source },
    beam: run.beam, nodes, state: st, assumptions: run.assumptions, gate, coverage, bom,
  }));
  if (md.found) event(run, `${md.found} key-like string(s) removed from the task file`);

  // Co-usage signal for later binds. Eval runs never feed it.
  const primaries = [...new Set(leaves.filter((l) => l.status === "bound").flatMap((l) => l.capabilities.filter((c) => c.role === "primary").map((c) => c.catalog_id)))];
  if (run.source !== "eval" && primaries.length >= 2) {
    const { error } = await deps.db.rpc("bump_co_usage", { p_ids: primaries });
    if (error) event(run, `co-usage update skipped: ${clip(error.message, 80)}`);
  }

  // Privacy: unless the user opted in, the raw request and attachment text are dropped now. The plan stays.
  if (!run.keep_text) run.beam = { ...run.beam, request: "", attachments: run.beam.attachments.map((a) => ({ name: a.name, text: "" })) };
  run.task_md = md.text;
  run.coverage = coverage;
  run.status = "done";
  run.phase = "done";
  event(run, `Done: ${leaves.length} step(s), ${coverage.criteria_traced}/${coverage.criteria_total} criteria traced, ${bom.length} catalog item(s)`);
}

/** One bounded step. Safe to call repeatedly; a second caller during a step gets `busy`. */
export async function step(deps: EngineDeps, id: string): Promise<StepResult | null> {
  const { db } = deps;
  const first = await loadRun(db, id);
  if (!first) return null;
  const idle = (r: RunRow, busy = false): StepResult => ({ status: r.status, phase: r.phase, awaiting: r.status === "running" && r.phase === "decisions" ? "decisions" : null, busy, error: r.state.error });
  if (first.status !== "running" || first.phase === "decisions") return idle(first);
  if (!(await claimRun(db, id, LIMITS.lockSeconds))) return idle(first, true);

  let run = first;
  try {
    run = (await loadRun(db, id)) ?? first; // re-read under the lock
    if (run.status !== "running" || run.phase === "decisions") return idle(run);
    const w: Work = { deps, run, nodes: await loadNodes(db, id), meter: newMeter(), bindings: [], extra: {} };
    let error: string | null = null;
    try {
      const budget = run.token_budget ?? PRESETS[run.preset].tokenBudget;
      if (["expand", "obstacles", "critic"].includes(run.phase) && run.tokens_in + run.tokens_out >= budget) {
        const n = stopPending(w, "budget", "The token budget ran out before this need was worked on.");
        event(run, `Token budget reached (${budget}); ${n} open need(s) marked unresolved`);
        run.phase = "finalize";
      } else if (run.phase === "intake") await intakeStep(w);
      else if (run.phase === "expand") await expandStep(w);
      else if (run.phase === "obstacles") await obstacleStep(w);
      else if (run.phase === "critic") await criticStep(w);
      else if (run.phase === "finalize") await finalizeStep(w);
      run.state.step_errors = 0;
      run.state.error = null;
    } catch (e) {
      error = redact(e);
      run.state.step_errors += 1;
      run.state.error = error;
      event(run, `Step failed (${run.phase}): ${error}`);
      if (run.state.step_errors >= 3) { run.status = "failed"; event(run, "Run failed after three failed steps in a row"); }
    }
    run.state.llm_calls += w.meter.calls;
    run.tokens_in += w.meter.in;
    run.tokens_out += w.meter.out;
    await upsertNodes(db, w.nodes);
    await insertBindings(db, w.bindings);
    await saveRun(db, id, {
      status: run.status, phase: run.phase, beam: run.beam, state: run.state, assumptions: run.assumptions, coverage: run.coverage,
      tokens_in: run.tokens_in, tokens_out: run.tokens_out, task_md: run.task_md, ...w.extra,
    });
    return { ...idle(run), error };
  } finally {
    await releaseRun(db, id);
  }
}

/** Runs steps until the run is done, failed, or waiting for decisions. For evals and tests. */
export async function runToEnd(deps: EngineDeps, id: string, opts: { maxSteps?: number; autoDecide?: boolean; onStep?: (r: StepResult) => void } = {}): Promise<StepResult> {
  let last: StepResult | null = null;
  for (let i = 0; i < (opts.maxSteps ?? 200); i++) {
    last = await step(deps, id);
    if (!last) throw new Error("run not found");
    opts.onStep?.(last);
    if (last.awaiting === "decisions") {
      if (!opts.autoDecide) return last;
      await answerDecisions(deps.db, id, {});
      continue;
    }
    if (last.status !== "running") return last;
  }
  throw new Error(`run ${id} did not finish in ${opts.maxSteps ?? 200} steps (last phase ${last?.phase})`);
}
