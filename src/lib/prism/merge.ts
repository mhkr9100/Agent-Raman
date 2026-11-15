// Merge (FRAMEWORK §4 "merge"): the leaves' Capabilities rows become one Bill of Materials (one row per catalog
// item, with every step that uses it), constraints are unioned, and runtime coherence is checked. Code only.
import { byKey, leavesOf } from "./gates";
import { jaccard } from "./text";
import type { Beam, BomRow, PNode } from "./types";

export interface MergedRow {
  id: string;
  row: BomRow;
  /** Steps that use the item as their primary. */
  steps: string[];
  /** Steps for which the item is only a fallback. */
  fallback_for: string[];
  purposes: string[];
  /** "low" = attached at a stop rule without an accepted coverage judgment. */
  confidence: "accepted" | "low";
}

export function mergeBom(nodes: PNode[]): MergedRow[] {
  const map = new Map<string, MergedRow>();
  for (const n of leavesOf(nodes)) {
    for (const row of n.capabilities) {
      let m = map.get(row.catalog_id);
      if (!m) {
        m = { id: "", row, steps: [], fallback_for: [], purposes: [], confidence: n.status === "bound" ? "accepted" : "low" };
        map.set(row.catalog_id, m);
      }
      if (row.role === "primary") {
        m.steps.push(n.key);
        if (m.row.role !== "primary") m.row = row;
        if (n.status === "bound") m.confidence = "accepted";
      } else m.fallback_for.push(n.key);
      if (!m.purposes.includes(row.purpose)) m.purposes.push(row.purpose);
    }
  }
  const rows = [...map.values()].sort((a, b) => Number(b.steps.length > 0) - Number(a.steps.length > 0));
  rows.forEach((r, i) => (r.id = `B${i + 1}`));
  return rows;
}

export function unionConstraints(nodes: PNode[]): { text: string; steps: string[] }[] {
  const out: { text: string; steps: string[] }[] = [];
  for (const n of leavesOf(nodes)) {
    for (const c of n.constraints_spec.items) {
      const hit = out.find((o) => jaccard(o.text, c) >= 0.8);
      if (hit) { if (!hit.steps.includes(n.key)) hit.steps.push(n.key); } else out.push({ text: c, steps: [n.key] });
    }
  }
  return out;
}

/** Leaf steps in an order that respects depends_on (a dependency on a split node means all its leaves). */
export function runOrder(nodes: PNode[]): PNode[] {
  const leaves = leavesOf(nodes);
  const leafKeys = new Set(leaves.map((l) => l.key));
  const expand = (k: string) => (leafKeys.has(k) ? [k] : leaves.filter((l) => l.key.startsWith(`${k}.`)).map((l) => l.key));
  const deps = new Map(leaves.map((l) => [l.key, new Set(l.goal.depends_on.flatMap(expand).filter((k) => k !== l.key))]));
  const done: PNode[] = [];
  const placed = new Set<string>();
  const rest = [...leaves].sort(byKey);
  while (rest.length) {
    const i = rest.findIndex((l) => [...deps.get(l.key)!].every((d) => placed.has(d)));
    const [next] = rest.splice(i >= 0 ? i : 0, 1); // a cycle falls back to outline order
    placed.add(next.key);
    done.push(next);
  }
  return done;
}

/** Findings a person should see before the executor starts (rendered under Open questions). */
export function mergeNotes(beam: Beam, nodes: PNode[]): string[] {
  const notes: string[] = [];
  const leaves = leavesOf(nodes);
  const byK = new Map(leaves.map((l) => [l.key, l]));
  for (const l of leaves) {
    for (const d of l.goal.depends_on) {
      const dep = byK.get(d);
      if (!dep) continue;
      if (l.runtime === "scheduled_host" && l.goal.recurring && dep.runtime === "human" && dep.goal.recurring)
        notes.push(`Step ${l.key} repeats on the schedule but waits on step ${d}, which needs a person every cycle. Decide whether that step can be done once, up front.`);
      if (l.runtime === "scheduled_host" && dep.runtime === "executor_session" && dep.goal.recurring)
        notes.push(`Step ${l.key} runs unattended on the scheduled host but takes its input from step ${d}, which only runs inside an open agent session.`);
    }
    if (l.runtime === "scheduled_host" && l.status === "bound")
      notes.push(`Step ${l.key} uses ${l.capabilities[0]?.name} on the scheduled host: confirm it can run there without an agent session.`);
  }
  if (beam.cadence && !leaves.some((l) => l.runtime === "scheduled_host"))
    notes.push(`The request has a cadence ("${beam.cadence}") but no step runs on a scheduled host.`);
  return [...new Set(notes)];
}
