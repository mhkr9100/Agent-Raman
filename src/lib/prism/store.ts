// Run and node persistence. Server-only (service role). Every write of user-derived text goes through here.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BindingRow } from "./expand";
import { byKey } from "./gates";
import { emptyState, type PNode, type RunRow, type RunState } from "./types";

const RUN_COLS = "id,created_at,preset,executor,model,provider,source,status,phase,beam,state,assumptions,coverage,tokens_in,tokens_out,token_budget,task_md,keep_text,request_hash";
const NODE_COLS = "id,run_id,parent_id,key,depth,status,refinement,runtime,goal,inputs,instructions,capabilities,constraints_spec,output,check_spec,trace,self_eval,tokens_used";

const fail = (what: string, message: string) => new Error(`${what}: ${message}`);
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function loadRun(db: SupabaseClient, id: string): Promise<RunRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db.from("run").select(RUN_COLS).eq("id", id).maybeSingle();
  if (error) throw fail("load run", error.message);
  if (!data) return null;
  const row = data as unknown as RunRow;
  row.state = { ...emptyState(), ...(row.state as Partial<RunState>) };
  row.assumptions ??= [];
  return row;
}

export async function insertRun(db: SupabaseClient, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from("run").insert(row).select("id").single();
  if (error) throw fail("create run", error.message);
  return data.id as string;
}

export async function saveRun(db: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("run").update(patch).eq("id", id);
  if (error) throw fail("save run", error.message);
}

export async function deleteRun(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("run").delete().eq("id", id);
  if (error) throw fail("delete run", error.message);
}

export async function loadNodes(db: SupabaseClient, runId: string): Promise<PNode[]> {
  const { data, error } = await db.from("node").select(NODE_COLS).eq("run_id", runId).limit(1000);
  if (error) throw fail("load nodes", error.message);
  return ((data ?? []) as unknown as PNode[]).sort(byKey);
}

/** Writes nodes marked dirty (parents before children) and clears the mark. */
export async function upsertNodes(db: SupabaseClient, nodes: PNode[]): Promise<number> {
  const dirty = nodes.filter((n) => n.dirty).sort((a, b) => a.depth - b.depth);
  if (!dirty.length) return 0;
  const rows = dirty.map((n) => {
    const row: Record<string, unknown> = { ...n };
    delete row.dirty;
    return row;
  });
  const { error } = await db.from("node").upsert(rows, { onConflict: "id" });
  if (error) throw fail("save nodes", error.message);
  for (const n of dirty) n.dirty = false;
  return dirty.length;
}

export async function insertBindings(db: SupabaseClient, rows: BindingRow[]): Promise<void> {
  if (!rows.length) return;
  const seen = new Set<string>();
  const unique = rows.filter((r) => !seen.has(`${r.node_id}:${r.capability_id}`) && !!seen.add(`${r.node_id}:${r.capability_id}`));
  const { error } = await db.from("binding").upsert(unique, { onConflict: "node_id,capability_id", ignoreDuplicates: true });
  if (error) throw fail("save bindings", error.message);
}

export async function claimRun(db: SupabaseClient, id: string, seconds: number): Promise<boolean> {
  const { data, error } = await db.rpc("claim_run", { p_run: id, p_seconds: seconds });
  if (error) throw fail("claim run", error.message);
  return data === true;
}

export async function releaseRun(db: SupabaseClient, id: string): Promise<void> {
  await db.rpc("release_run", { p_run: id });
}

/** What the browser may see of a run. No request text, no attachment text, no node internals beyond the outline. */
export function runView(run: RunRow, nodes: PNode[]) {
  const budget = run.token_budget ?? 0;
  return {
    id: run.id,
    created_at: run.created_at,
    status: run.status,
    phase: run.phase,
    preset: run.preset,
    executor: run.executor,
    model: run.model,
    provider: run.provider,
    awaiting: run.status === "running" && run.phase === "decisions" ? ("decisions" as const) : null,
    beam: {
      summary: run.beam.summary ?? "",
      cadence: run.beam.cadence ?? null,
      criteria: (run.beam.criteria ?? []).map((c) => ({ id: c.id, text: c.text, source: c.source })),
      decisions: (run.beam.decisions ?? []).map((d) => ({ id: d.id, question: d.question, options: d.options, default: d.default, why: d.why, answer: d.answer })),
    },
    nodes: nodes.map((n) => ({
      id: n.id,
      parent_id: n.parent_id,
      key: n.key,
      depth: n.depth,
      status: n.status,
      goal: n.goal.text,
      category: n.goal.category,
      origin: n.goal.origin,
      runtime: n.runtime,
      note: n.goal.note,
      check: n.check_spec.criterion,
      capabilities: n.capabilities.map((c) => ({ name: c.name, kind: c.kind, slug: c.slug, role: c.role })),
    })),
    state: {
      events: run.state.events.slice(-60),
      critic_rounds: run.state.critic_rounds,
      critic_log: run.state.critic_log,
      chapman: run.state.chapman,
      diff: run.state.diff,
      seed: run.state.seed ? { similarity: run.state.seed.similarity } : null,
      error: run.state.error,
    },
    assumptions: run.assumptions,
    tokens: { in: run.tokens_in, out: run.tokens_out, budget },
    coverage: run.coverage,
    has_task_md: !!run.task_md,
  };
}
export type RunView = ReturnType<typeof runView>;
