// Adversarial critic (FRAMEWORK §4 "completeness critic"; RAMAN-TASK R7 gate). The LLM proposes what the plan
// misses; CODE decides. A proposal enters the tree only with evidence code can check:
//   (i)   it names an untraced criterion or an empty category, or quotes a request span no criterion covers;
//   (ii)  it quotes a stored field of a catalog item the plan already binds;
//   (iii) it gives a public URL and a quote that is really on that page (fetched with an SSRF guard).
// Everything else goes to the Assumptions ledger as unverified, never into the tree.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ask, fence, UNTRUSTED } from "./ask";
import { beamBrief, newNode, nextChildKey } from "./expand";
import { leavesOf } from "./gates";
import { clip, jaccard, quoted } from "./text";
import { CATEGORIES, type Assumption, type Beam, type CriticProposal, type GateReport, type PNode, type RunState } from "./types";

const schema = z.object({
  proposals: z.array(z.object({
    missing: z.string().describe("What the plan lacks, in one sentence"),
    category: z.enum(CATEGORIES),
    evidence: z.enum(["span", "criterion", "category", "catalog_field", "url_quote", "none"]),
    span: z.string().describe("evidence=span: verbatim quote from the request. Else empty."),
    criterion_id: z.string().describe("evidence=criterion: the criterion id (C1…). Else empty."),
    catalog_slug: z.string().describe("evidence=catalog_field: slug of the bound item. Else empty."),
    quote: z.string().describe("evidence=catalog_field or url_quote: verbatim quote (20+ characters) that proves the gap. Else empty."),
    url: z.string().describe("evidence=url_quote: https URL of the public page holding the quote. Else empty."),
    target_key: z.string().describe("Key of the plan step this belongs under; empty for top level"),
    need: z.string().describe("The missing need, written as an outcome, without naming a tool"),
    kind_hint: z.enum(["capability", "artifact", "human"]),
  })),
});

export const FRAMINGS = {
  auditor: "You are an auditor. Compare the plan with the request line by line and list what the request asks for that no step delivers.",
  premortem: "Assume an agent followed this plan exactly and the task still failed in its first week. List the missing steps that caused the failure.",
} as const;
export type Framing = keyof typeof FRAMINGS;

const SYSTEM = (framing: Framing) => [
  `You are the completeness critic of Agent Raman. ${FRAMINGS[framing]} You never perform the task.`,
  "Return at most 6 proposals; an empty list is a valid answer. Do not repeat a step the plan already has.",
  "Every proposal needs evidence a program can check: a verbatim request quote (span), an acceptance criterion id that no step serves (criterion), an empty category (category), a verbatim quote from the stored description of an item the plan binds (catalog_field), or an https URL plus a verbatim quote from that page (url_quote).",
  "If you cannot give such evidence, set evidence to 'none'. Do not invent quotes, URLs, endpoints or product features: every quote is checked, and a proposal whose quote is not found is discarded.",
  UNTRUSTED,
].join("\n");

export function planOutline(nodes: PNode[]): string {
  return leavesOf(nodes)
    .map((n) => {
      const cap = n.capabilities.find((c) => c.role === "primary");
      return `${n.key} [${n.status}; ${n.goal.category}; ${n.runtime}] ${clip(n.goal.text, 160)}${cap ? ` → ${cap.name} (slug ${cap.slug})` : ""} | check: ${clip(n.check_spec.criterion, 100) || "none"} | serves: ${n.trace.filter((t) => /^C\d+$/.test(t)).join(",") || "—"}`;
    })
    .join("\n");
}

export async function propose(model: LanguageModel, framing: Framing, beam: Beam, nodes: PNode[], gate: GateReport): Promise<CriticProposal[]> {
  const prompt = [
    beamBrief(beam),
    "",
    "Plan (leaf steps):",
    fence("catalog", planOutline(nodes)),
    `Criteria no step serves: ${gate.untraced.join(", ") || "none"}`,
    `Empty categories: ${gate.empty_categories.join(", ") || "none"}`,
  ].join("\n");
  const out = await ask(model, { tag: `raman:critic:${framing}`, system: SYSTEM(framing), prompt, schema });
  const kept: CriticProposal[] = [];
  for (const p of out.proposals) {
    if (!p.missing.trim() || !p.need.trim()) continue;
    if (kept.some((k) => jaccard(k.need, p.need) >= 0.7)) continue;
    kept.push({ ...p, missing: clip(p.missing.trim(), 300), need: clip(p.need.trim(), 300) });
    if (kept.length === 6) break;
  }
  return kept;
}

/** Chapman estimator over two independent reviews (FRAMEWORK §6): how many gaps exist in total, found or not. */
export function chapman(a: CriticProposal[], b: CriticProposal[]): NonNullable<RunState["chapman"]> {
  const same = (x: CriticProposal, y: CriticProposal) =>
    (x.category === y.category || (!!x.criterion_id && x.criterion_id === y.criterion_id)) && jaccard(`${x.missing} ${x.need}`, `${y.missing} ${y.need}`) >= 0.5;
  const used = new Set<number>();
  let m = 0;
  for (const x of a) {
    const j = b.findIndex((y, i) => !used.has(i) && same(x, y));
    if (j >= 0) { used.add(j); m++; }
  }
  const n1 = a.length, n2 = b.length;
  return { n1, n2, m, estimate: n1 + n2 === 0 ? 0 : Math.round((((n1 + 1) * (n2 + 1)) / (m + 1) - 1) * 10) / 10 };
}

// --- (iii) fetch-and-match, with an SSRF guard ---------------------------------------------------------------
// The URL comes from an LLM, so it is hostile input: https only, public hostnames only, every resolved address
// checked against private ranges (RFC 1918, RFC 4193, loopback, link-local, CGNAT), no redirects followed,
// 5 s, 500 KB. Residual risk: DNS can change between this check and the fetch; the response is only ever
// substring-matched, never returned to the model or the user.
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("::ffff:");
}

export type FetchPage = (url: string) => Promise<string | null>;

/** A public https URL (port 443, a DNS name that resolves only to public addresses), or null. */
export async function publicHttpsUrl(raw: string): Promise<URL | null> {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || /(^|\.)(localhost|internal|local|lan|home|corp|test|invalid)$/.test(host)) return null;
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) return null;
    return url;
  } catch {
    return null;
  }
}

export const safeFetchPage: FetchPage = async (raw) => {
  try {
    const url = await publicHttpsUrl(raw);
    if (!url) return null;
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { accept: "text/html,text/plain,application/json;q=0.9", "user-agent": "AgentRaman-critic/1.0" } });
    if (res.status !== 200 || !/^(text\/|application\/(json|xhtml))/.test(res.headers.get("content-type") ?? "")) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 500_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString("utf8").slice(0, 500_000);
    return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"');
  } catch {
    return null;
  }
};

export interface CriticCtx {
  db: SupabaseClient;
  run: { id: string };
  beam: Beam;
  nodes: PNode[];
  gate: GateReport;
  assumptions: Assumption[];
  round: number;
  /** Injected in tests. */
  fetchPage?: FetchPage;
}

export interface Adjudication { accepted: PNode[]; ledger: Assumption[]; log: RunState["critic_log"]; events: string[] }

/** Stored fields of the items the plan binds, by slug. Catalog text is data: it is only substring-matched. */
async function boundFields(db: SupabaseClient, nodes: PNode[]): Promise<Map<string, string>> {
  const slugs = [...new Set(nodes.flatMap((n) => (n.status === "bound" ? n.capabilities.map((c) => c.slug) : [])))];
  if (!slugs.length) return new Map();
  const { data, error } = await db.from("capability").select("slug,name,description,tos_notes,licence,install,auth,pricing,runtime_compat,clients_supported").in("slug", slugs.slice(0, 100));
  if (error) throw new Error(`critic catalog read: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.slug as string, Object.values(r).map((v) => (typeof v === "string" ? v : JSON.stringify(v ?? ""))).join("\n")]));
}

export async function adjudicate(ctx: CriticCtx, proposals: { framing: Framing; p: CriticProposal }[]): Promise<Adjudication> {
  const out: Adjudication = { accepted: [], ledger: [], log: [], events: [] };
  const { beam, gate, round } = ctx;
  const haystack = [beam.request, ...beam.attachments.map((a) => a.text)].join("\n\n");
  const fields = proposals.some((x) => x.p.evidence === "catalog_field") ? await boundFields(ctx.db, ctx.nodes) : new Map<string, string>();
  const fetchPage = ctx.fetchPage ?? safeFetchPage;
  const all = [...ctx.nodes];
  const root = all.find((n) => n.key === "0")!;
  const untraced = new Set(gate.untraced);
  const empty = new Set(gate.empty_categories);
  let seq = ctx.assumptions.length;
  let fetches = 0;

  for (const { framing, p } of proposals) {
    const log = (verdict: "accepted" | "ledger", rule: string) => out.log.push({ round, framing, missing: clip(p.missing, 200), verdict, rule });
    if (all.some((n) => jaccard(n.goal.text, p.need) >= 0.7)) { log("ledger", "duplicate_of_existing_step"); continue; }

    let rule = "";
    let criterionId: string | null = null;
    const cid = p.criterion_id.trim().toUpperCase();
    if (p.evidence === "criterion" && untraced.has(cid)) {
      rule = "untraced_criterion";
      criterionId = cid;
    } else if (p.evidence === "category" && empty.has(p.category)) {
      rule = "empty_category";
    } else if (p.evidence === "span" && quoted(haystack, p.span, 12)) {
      // A real quote counts only when no criterion already stands on it; otherwise the gap is an opinion.
      const covered = beam.spans.some((s) => (quoted(s.text, p.span, 12) || quoted(p.span, s.text, 12) || jaccard(s.text, p.span) >= 0.6) && beam.criteria.some((c) => c.span_ids.includes(s.id)));
      if (!covered) {
        const span = { id: `S${beam.spans.length + 1}`, text: p.span.trim(), kind: "constraint" as const };
        beam.spans.push(span);
        criterionId = `C${beam.criteria.length + 1}`;
        beam.criteria.push({ id: criterionId, text: p.missing, span_ids: [span.id], source: "critic" });
        rule = "request_span";
      }
    } else if (p.evidence === "catalog_field" && p.quote.trim().length >= 20 && quoted(fields.get(p.catalog_slug.trim()) ?? "", p.quote, 20)) {
      rule = "catalog_field";
    } else if (p.evidence === "url_quote" && p.quote.trim().length >= 20 && p.url.trim() && fetches < 4) {
      fetches++;
      const page = await fetchPage(p.url.trim());
      if (page && quoted(page, p.quote, 20)) rule = "url_quote";
    }

    if (!rule) {
      out.ledger.push({
        id: `A${++seq}`, source: "critic_unverified", ref: `critic r${round} ${framing}`,
        text: clip(`Critic suggestion that could not be verified, so it is NOT in the plan: ${p.missing}${p.evidence !== "none" ? ` (claimed evidence: ${p.evidence}, not found)` : ""}`, 400),
      });
      log("ledger", p.evidence === "none" ? "no_evidence" : `${p.evidence}_not_verified`);
      continue;
    }

    const target = all.find((n) => n.key === p.target_key.trim() && n.status === "split") ?? root;
    const node = newNode(ctx.run.id, target, nextChildKey(all, target), { text: p.need, category: p.category, kind_hint: p.kind_hint, origin: "inferred:critic", priority: "should" });
    node.runtime = p.kind_hint === "human" ? "human" : "executor_session";
    node.trace = [...(criterionId ? [criterionId] : []), `inferred:critic:r${round}`];
    node.goal.note = `Added by the critic (round ${round}, ${framing}); evidence checked by code: ${rule}${rule === "url_quote" ? ` at ${clip(p.url.trim(), 200)}` : ""}.`;
    node.check_spec = { criterion: `The gap is closed: ${clip(p.missing, 300)}`, on_fail: "Stop and report to the user", enforcement: "instruction" };
    node.output = { deliverable: p.need, contract: "", destination: "", side_effect: "none", rollback: null };
    all.push(node);
    out.accepted.push(node);
    if (criterionId) untraced.delete(criterionId);
    if (rule === "empty_category") empty.delete(p.category);
    log("accepted", rule);
    out.events.push(`critic r${round}: accepted (${rule}) → step ${node.key}`);
  }
  if (out.ledger.length) out.events.push(`critic r${round}: ${out.ledger.length} unverified suggestion(s) → ledger`);
  return out;
}
