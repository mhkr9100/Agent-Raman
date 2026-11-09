// Re-rank (FRAMEWORK §7 rows 5, 6, 7, 10, 11): ranking signals only reorder what retrieval found. The boost is
// multiplicative on the RRF score so relevance stays the base; weights are tuned on evals/binder.json.
// Signal coverage today (2026-11-09): only ClawHub rows carry usage/votes; MCP rows rely on curation
// (awesome-mcp-servers, official Claude marketplace). The `official` flag is not used: it marks registry
// namespace = repo owner, not vendor ownership (docs/BACKLOG.md).
import type { BindConstraints, Candidate, Card, SignalScores } from "./types";

export interface Weights {
  usage: number;
  votes: number;
  curation: number;
  co_usage: number;
  quality: number;
}

export const DEFAULT_WEIGHTS: Weights = { usage: 0.6, votes: 0.3, curation: 1.0, co_usage: 0.5, quality: 0.5 };

const log01 = (x: number, decades: number) => Math.min(1, Math.log10(1 + Math.max(0, x)) / decades);

export function signalScores(card: Card): SignalScores {
  const ch = card.signals?.clawhub ?? {};
  const q = card.quality ?? {};
  // ClawHub's moderation filter: false means the listing was flagged suspicious.
  const flagged = q.non_suspicious_filter === false;
  return {
    usage: log01(Number(ch.installs ?? 0), 4), // 10k installs → 1
    votes: log01(Number(ch.stars ?? 0), 3), // 1k stars → 1
    curation: Math.min(1, card.curated_count / 2 + (card.source_count > 1 ? 0.25 : 0)),
    co_usage: log01(card.co_usage, 2),
    quality: flagged ? -1 : 0,
  };
}

/** Hard checks the code can make without an LLM (FRAMEWORK §3 rule 4 Runnable, client compatibility). */
export function ineligibility(card: Card, c: BindConstraints | undefined): string[] {
  const why: string[] = [];
  if (!c) return why;
  if (c.kinds && !c.kinds.includes(card.kind)) why.push(`kind ${card.kind} not allowed here`);
  if (c.runtime && card.runtime_compat.length) {
    const rt = c.runtime.startsWith("scheduled_host") ? "scheduled_host" : c.runtime;
    if (rt !== "human" && !card.runtime_compat.includes(rt)) {
      why.push(`runs only in ${card.runtime_compat.join("/")}, node runtime is ${c.runtime}`);
    }
  }
  if (c.executor && card.clients_supported.length && !card.clients_supported.includes("any") &&
      !card.clients_supported.includes(c.executor)) {
    why.push(`not supported in ${c.executor} (supports ${card.clients_supported.join(", ")})`);
  }
  return why;
}

export function rerank(
  fused: { id: string; rrf: number; ranks: Candidate["ranks"] }[],
  cards: Map<string, Card>,
  constraints: BindConstraints | undefined,
  w: Weights = DEFAULT_WEIGHTS,
): Candidate[] {
  const out: Candidate[] = [];
  for (const f of fused) {
    const card = cards.get(f.id);
    if (!card) continue;
    const s = signalScores(card);
    const boost = 1 + w.usage * s.usage + w.votes * s.votes + w.curation * s.curation + w.co_usage * s.co_usage + w.quality * s.quality;
    out.push({ card, rrf: f.rrf, ranks: f.ranks, signals: s, score: f.rrf * Math.max(0.1, boost), ineligible: ineligibility(card, constraints) });
  }
  return out.sort((a, b) => b.score - a.score);
}
