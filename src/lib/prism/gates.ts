// Coverage gates (FRAMEWORK §6). All code, no LLM: forward trace (criterion → leaf), category gate, backward
// trace (leaf → criterion or declared inference), and the four leaf gates Bound ∧ Checkable ∧ Traced ∧ Runnable.
import { CATEGORIES, LEAF_STATUSES, type Beam, type Category, type Coverage, type GateReport, type PNode, type RunState } from "./types";

// Categories the task file itself always supplies (RAMAN-TASK §8): packaging blocks, the report-back spec and
// the Checks section are rendered for every run, so they need no leaf of their own.
const STRUCTURAL: Category[] = ["packaging", "telemetry", "acceptance_checks"];

export const isLeaf = (n: PNode) => LEAF_STATUSES.includes(n.status);
export const leavesOf = (nodes: PNode[]) => nodes.filter(isLeaf).sort(byKey);

export function byKey(a: PNode, b: PNode): number {
  const x = a.key.split(".").map(Number), y = b.key.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** The four leaf gates. `Bound` is true for honest build/human leaves: nothing was claimed that is not there. */
export function leafGates(n: PNode, nodes: PNode[], beam: Beam): Record<string, boolean> {
  const keys = new Set(nodes.map((x) => x.key));
  const criteria = new Set(beam.criteria.map((c) => c.id));
  return {
    bound: n.status === "bound" ? n.capabilities.some((c) => c.role === "primary") : n.status === "build" || n.status === "human",
    checkable: n.check_spec.criterion.trim().length > 0,
    traced: n.trace.some((t) => criteria.has(t) || t.startsWith("inferred:")),
    runnable:
      !!n.runtime &&
      n.goal.depends_on.every((k) => keys.has(k)) &&
      n.inputs.every((i) => i.type !== "credential" || !!i.env_var || i.name.startsWith("Header ")) &&
      (n.output.side_effect === "none" || !!n.output.rollback),
  };
}

export function runGates(beam: Beam, nodes: PNode[], state: RunState): GateReport {
  const leaves = leavesOf(nodes);
  const criteria = new Set(beam.criteria.map((c) => c.id));

  const forward = beam.criteria.map((c) => ({ criterion_id: c.id, text: c.text, leaves: leaves.filter((l) => l.trace.includes(c.id)).map((l) => l.key) }));
  const untraced = forward.filter((f) => f.leaves.length === 0).map((f) => f.criterion_id);

  const categories = CATEGORIES.map((category) => {
    const by = leaves.filter((l) => l.goal.category === category).map((l) => l.key);
    if (by.length) return { category, status: "covered" as const, by };
    if (STRUCTURAL.includes(category)) return { category, status: "structural" as const, by: ["supplied by the task file itself"] };
    const na = state.na_categories.find((x) => x.category === category);
    if (na) return { category, status: "not_applicable" as const, by: [na.why] };
    return { category, status: "empty" as const, by: [] };
  });

  const byKeyMap = new Map(nodes.map((n) => [n.key, n]));
  const contract_issues: string[] = [];
  for (const l of leaves) {
    for (const d of l.goal.depends_on) {
      const dep = byKeyMap.get(d);
      if (!dep) contract_issues.push(`Step ${l.key} depends on step ${d}, which does not exist.`);
      else if (dep.status === "unresolved") contract_issues.push(`Step ${l.key} depends on step ${d}, which is unresolved.`);
    }
  }

  const leaf_gate_failures = leaves
    .map((l) => ({ key: l.key, failed: Object.entries(leafGates(l, nodes, beam)).filter(([, ok]) => !ok).map(([g]) => g) }))
    .filter((f) => f.failed.length > 0);

  return {
    forward,
    untraced,
    categories,
    empty_categories: categories.filter((c) => c.status === "empty").map((c) => c.category),
    backward_orphans: leaves.filter((l) => !l.trace.some((t) => criteria.has(t) || t.startsWith("inferred:"))).map((l) => l.key),
    leaf_gate_failures,
    contract_issues,
  };
}

export function coverageOf(beam: Beam, nodes: PNode[], state: RunState, gate: GateReport, bomSize: number): Coverage {
  const leaves = leavesOf(nodes);
  const counts: Record<string, number> = {};
  for (const l of leaves) counts[l.status] = (counts[l.status] ?? 0) + 1;
  return {
    criteria_total: beam.criteria.length,
    criteria_traced: beam.criteria.length - gate.untraced.length,
    leaves: counts,
    categories_covered: gate.categories.filter((c) => c.status !== "empty").length,
    categories_empty: gate.empty_categories,
    inferred_leaves: leaves.filter((l) => l.goal.origin !== "request").length,
    chapman: state.chapman,
    bom: bomSize,
  };
}
