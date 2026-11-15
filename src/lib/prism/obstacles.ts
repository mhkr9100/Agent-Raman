// Obstacle pass (FRAMEWORK §4, per-leaf self-evaluation): for each leaf, what could stop the executor, and where
// does the answer go? The LLM names obstacles; code applies them: an on_fail line, a decision input, a new
// sibling need (which goes back through bind-before-split), or an Assumptions ledger entry.
import type { LanguageModel } from "ai";
import { z } from "zod";
import { ask, UNTRUSTED } from "./ask";
import { beamBrief, newNode, nextChildKey } from "./expand";
import { clip, jaccard } from "./text";
import { PRESETS, type Assumption, type Beam, type PNode, type Preset, type RunState } from "./types";

export const OBSTACLE_BATCH = 12;
const OBSTACLE_TAG = "inferred:rule:obstacle";

const schema = z.object({
  leaves: z.array(z.object({
    key: z.string(),
    confidence: z.number().describe("0 to 1: how likely the executor completes this step as written"),
    reason: z.string(),
    obstacles: z.array(z.object({
      type: z.enum(["access", "rate_limit", "permission", "missing_data", "ambiguity", "cost", "runtime", "irreversible", "other"]),
      resolution: z.enum(["sibling_leaf", "on_fail", "decision", "none"]),
      text: z.string().describe("The obstacle in one sentence"),
      need: z.string().describe("For sibling_leaf: the new need, as an outcome. For on_fail: what to do. For decision: the question for the user. Else empty."),
      kind_hint: z.enum(["capability", "artifact", "human"]),
    })),
  })),
});

const SYSTEM = [
  "You are the obstacle check of Agent Raman. For each step of a plan, name what could realistically stop an AI agent from completing it. You never perform the task.",
  "Name at most 3 obstacles per step, and only ones the step as written does not already handle. No obstacle is a valid answer.",
  "resolution: 'sibling_leaf' when a separate step is needed (for example: obtain access, create an account, add a retry queue); 'on_fail' when one line of failure handling is enough; 'decision' when only the user can settle it; 'none' when it can only be noted.",
  "Do not state facts about a named product (limits, prices, endpoints) unless they appear in the text you were given.",
  UNTRUSTED,
].join("\n");

export interface ObstacleResult { changed: PNode[]; created: PNode[]; assumptions: Assumption[]; events: string[] }

export async function obstaclePass(
  model: LanguageModel,
  ctx: { run: { id: string; preset: Preset }; beam: Beam; state: RunState; nodes: PNode[]; assumptions: Assumption[] },
  batch: PNode[],
): Promise<ObstacleResult> {
  const res: ObstacleResult = { changed: [], created: [], assumptions: [], events: [] };
  const lines = batch.map((n) =>
    [
      `Step ${n.key} [${n.status}, runs in ${n.runtime}]: ${n.goal.text}`,
      n.capabilities.length ? `  uses: ${n.capabilities.filter((c) => c.role === "primary").map((c) => `${c.name} (${c.kind})`).join(", ")}` : "",
      n.inputs.length ? `  inputs: ${n.inputs.map((i) => `${i.name} (${i.type})`).join(", ")}` : "",
      n.instructions.method ? `  method: ${n.instructions.method}` : "",
      `  check: ${n.check_spec.criterion || "none"}; on fail: ${n.check_spec.on_fail || "none"}; side effect: ${n.output.side_effect}`,
    ].filter(Boolean).join("\n"),
  );
  const out = await ask(model, {
    tag: "raman:obstacles",
    system: SYSTEM,
    prompt: `${beamBrief(ctx.beam)}\n\nSteps to check:\n${lines.join("\n")}`,
    schema,
  });

  const cap = PRESETS[ctx.run.preset].siblings;
  const all = [...ctx.nodes];
  let seq = ctx.assumptions.length;
  const assume = (text: string, ref: string) => res.assumptions.push({ id: `A${++seq}`, text: clip(text, 300), source: "obstacle", ref });

  for (const n of batch) {
    const r = out.leaves.find((l) => l.key.trim() === n.key);
    const obstacles = (r?.obstacles ?? []).filter((o) => o.text.trim()).slice(0, 3);
    n.self_eval = {
      confidence: Math.min(1, Math.max(0, r?.confidence ?? 0.5)),
      reason: clip(r?.reason ?? "Not assessed by the obstacle check", 300),
      obstacles: obstacles.map((o) => ({ type: o.type, resolution: o.resolution, text: clip(o.text, 240) })),
      gates: {},
    };
    n.dirty = true;
    res.changed.push(n);

    for (const o of obstacles) {
      const text = clip(o.text.trim(), 240);
      const need = clip(o.need.trim(), 240);
      const spawned = n.trace.includes(OBSTACLE_TAG); // a step created for an obstacle does not spawn more steps
      const parent = all.find((x) => x.id === n.parent_id);
      const duplicate = need && all.some((x) => jaccard(x.goal.text, need) >= 0.7);

      if (o.resolution === "sibling_leaf" && need && parent && !spawned && !duplicate && ctx.state.obstacle_siblings < cap && o.kind_hint !== "human") {
        const s = newNode(ctx.run.id, parent, nextChildKey(all, parent), {
          text: need, category: n.goal.category, kind_hint: o.kind_hint, origin: "inferred:rule", priority: "should",
        });
        s.runtime = n.runtime === "human" ? "executor_session" : n.runtime;
        s.trace = [...new Set([...n.trace, OBSTACLE_TAG])];
        s.goal.note = `Added by the obstacle check of step ${n.key}: ${text}`;
        s.check_spec = { criterion: `The obstacle is removed: ${text}`, on_fail: "Stop and report to the user", enforcement: "instruction" };
        s.output = { deliverable: need, contract: `Step ${n.key} can run without hitting this obstacle`, destination: "", side_effect: "none", rollback: null };
        all.push(s);
        res.created.push(s);
        ctx.state.obstacle_siblings += 1;
        if (!n.goal.depends_on.includes(s.key)) n.goal.depends_on.push(s.key);
        res.events.push(`${n.key} obstacle → new step ${s.key}`);
      } else if (o.resolution === "decision" || (o.resolution === "sibling_leaf" && o.kind_hint === "human")) {
        n.inputs.push({ name: clip(need || text, 80), type: "decision", detail: `Confirm before starting: ${need || text}`, env_var: null });
        assume(`Step ${n.key} needs the user's answer: ${need || text}`, n.key);
      } else if (o.resolution === "none") {
        assume(`Step ${n.key}, known risk (${o.type}): ${text}`, n.key);
      } else {
        // on_fail, or a sibling that the cap, a duplicate or the spawn rule refused: keep it as failure handling.
        n.check_spec.on_fail = clip([n.check_spec.on_fail, need ? `If ${text.replace(/\.$/, "")}: ${need}` : `Watch for: ${text}`].filter(Boolean).join(" "), 600);
      }
    }
  }
  return res;
}
