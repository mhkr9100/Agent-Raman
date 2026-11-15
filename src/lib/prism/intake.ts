// Intake (FRAMEWORK §4 root-only jobs): request → Beam. The LLM extracts; code verifies every quoted span against
// the request text, so a criterion is "explicit" only when its span really is in the request.
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Executor } from "../binder/types";
import { ask, fence, UNTRUSTED } from "./ask";
import { jaccard, quoted } from "./text";
import type { Beam, Criterion, Decision, Span } from "./types";

const SPAN_KINDS = ["goal", "deliverable", "constraint", "cadence", "system", "data", "quality"] as const;

const intakeSchema = z.object({
  summary: z.string().describe("One sentence: what the finished task delivers"),
  spans: z.array(z.object({ text: z.string().describe("Verbatim quote from the request or an attachment"), kind: z.enum(SPAN_KINDS) })),
  criteria: z.array(z.object({
    text: z.string().describe("One testable acceptance criterion"),
    spans: z.array(z.number()).describe("1-based indexes into spans; empty when the criterion is implied, not stated"),
  })),
  decisions: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()),
    default: z.string().describe("One of the options"),
    why: z.string().describe("What changes in the plan depending on the answer"),
  })),
  environment: z.object({ os: z.string(), tools_present: z.array(z.string()), notes: z.array(z.string()) }),
  out_of_scope: z.array(z.string()),
  cadence: z.string().describe("The schedule phrase when the task repeats (e.g. 'every 30 minutes'); empty for a one-off task"),
});

const gapSchema = z.object({
  missed: z.array(z.object({
    text: z.string().describe("The missed requirement as one testable criterion"),
    quote: z.string().describe("Verbatim quote from the request that states it"),
  })),
});

const INTAKE_SYSTEM = [
  "You are the intake step of Agent Raman. Raman turns one request into a task file for an AI agent (the executor). Raman never performs the task, and neither do you: extract, do not solve.",
  "spans: quotes copied character for character from the request or its attachments. Each is the shortest phrase that states one goal, deliverable, constraint, cadence, named system, data source or quality bar.",
  "criteria: acceptance criteria, one testable sentence each, citing the spans they come from. Add a criterion the request only implies when a careful reviewer would insist on it; give it an empty span list.",
  "decisions: at most 3 questions that the request leaves open AND whose answer changes which tools, accounts or hosts are needed. 2 to 4 options each, with a default. Never ask about style or preference.",
  "environment: only what the request states about the machine or accounts. Unknown fields stay empty.",
  "out_of_scope: what the request excludes. cadence: the schedule phrase when the task repeats, else an empty string.",
  UNTRUSTED,
].join("\n");

// "every 30 minutes", "hourly", "each weekday at 9:00", "once a week", "on a schedule", cron-like wording.
// "once a week" and "each weekday" were missed until the task eval caught them (evals/trend.jsonl, 2026-11-10).
const UNIT = "min(?:ute)?s?|hours?|hrs?|days?|weeks?|months?|quarters?|years?|mornings?|afternoons?|evenings?|nights?|weekdays?|weekends?|(?:mon|tues|wednes|thurs|fri|satur|sun)days?";
const CADENCE = new RegExp(
  "\\b(" + [
    `every\\s+(?:\\d+\\s*|other\\s+|single\\s+|few\\s+)?(?:${UNIT})`,
    `each\\s+(?:${UNIT})`,
    "(?:once|twice|(?:\\d+|two|three|four|five|six)\\s+times)\\s+(?:a|an|per|every|each)\\s+(?:minute|hour|day|week|month|quarter|year)",
    "hourly|daily|nightly|weekly|monthly|quarterly",
    "on\\s+a\\s+(?:schedule|cron)|cron\\s*(?:job|schedule)?|periodically|recurring(?:ly)?|around\\s+the\\s+clock",
  ].join("|") + ")\\b", "i");

export function detectCadence(text: string): string | null {
  const m = CADENCE.exec(text);
  return m ? m[0].replace(/\s+/g, " ") : null;
}

export const SCHED_ID = "D-sched";

/** Code rule: a repeating task needs something that starts it on time, and only the user can say what. */
export function schedulerDecision(cadence: string): Decision {
  return {
    id: SCHED_ID,
    question: `The task repeats ("${cadence}"). What will start it on time when no agent session is open?`,
    options: [
      "The executor's own scheduler, if it has one",
      "A CI scheduler (for example a scheduled workflow in the repo's CI)",
      "A server or VM with cron",
      "A workflow platform I already use",
      "Not decided: the executor must ask me before building the schedule",
    ],
    default: "Not decided: the executor must ask me before building the schedule",
    why: "A repeating task needs a host with a scheduler. Tools that only run inside an open agent session cannot meet the cadence on their own.",
    answer: null,
    source: "rule",
  };
}

export interface IntakeInput {
  request: string;
  attachments: { name: string; text: string }[];
  executor: Executor;
  twoCuts: boolean;
}

export async function intake(model: LanguageModel, input: IntakeInput): Promise<Beam> {
  const haystack = [input.request, ...input.attachments.map((a) => a.text)].join("\n\n");
  const body = [
    fence("request", input.request),
    ...input.attachments.map((a) => fence("attachment", `name: ${a.name}\n${a.text}`)),
    `Executor: ${input.executor}`,
  ].join("\n\n");

  const out = await ask(model, { tag: "raman:intake", system: INTAKE_SYSTEM, prompt: body, schema: intakeSchema });

  // Spans: keep only real quotes. Index map keeps the criteria's references valid.
  const spans: Span[] = [];
  const spanId = new Map<number, string>();
  out.spans.forEach((s, i) => {
    if (!quoted(haystack, s.text)) return;
    const id = `S${spans.length + 1}`;
    spans.push({ id, text: s.text.trim(), kind: s.kind });
    spanId.set(i + 1, id);
  });

  const criteria: Criterion[] = [];
  const addCriterion = (text: string, span_ids: string[], source: Criterion["source"]) => {
    const t = text.trim();
    if (!t || criteria.some((c) => jaccard(c.text, t) >= 0.8)) return;
    criteria.push({ id: `C${criteria.length + 1}`, text: t, span_ids, source });
  };
  for (const c of out.criteria) {
    const ids = [...new Set(c.spans.map((n) => spanId.get(n)).filter((x): x is string => !!x))];
    addCriterion(c.text, ids, ids.length ? "explicit" : "inferred");
  }

  // Second look (standard/deep): what did the first cut miss? Accepted only with a real quote.
  if (input.twoCuts && criteria.length) {
    const gap = await ask(model, {
      tag: "raman:intake-gap",
      system: [
        "You audit a list of acceptance criteria against the request it was written from.",
        "List only requirements the request states that no criterion covers. Each must quote the request verbatim. If nothing is missing, return an empty list.",
        UNTRUSTED,
      ].join("\n"),
      prompt: `${body}\n\nCriteria so far:\n${criteria.map((c) => `${c.id}. ${c.text}`).join("\n")}`,
      schema: gapSchema,
    }).catch(() => ({ missed: [] }));
    for (const m of gap.missed) {
      if (!quoted(haystack, m.quote, 8)) continue;
      let span = spans.find((s) => jaccard(s.text, m.quote) >= 0.8);
      if (!span) {
        span = { id: `S${spans.length + 1}`, text: m.quote.trim(), kind: "constraint" };
        spans.push(span);
      }
      addCriterion(m.text, [span.id], "explicit");
    }
  }

  const decisions: Decision[] = out.decisions
    .filter((d) => d.question.trim() && d.options.length >= 2)
    .slice(0, 3)
    .map((d, i) => {
      const options = [...new Set(d.options.map((o) => o.trim()).filter(Boolean))].slice(0, 4);
      return { id: `D${i + 1}`, question: d.question.trim(), options, default: options.includes(d.default.trim()) ? d.default.trim() : options[0], why: d.why.trim(), answer: null, source: "llm" as const };
    });

  // Cadence: the regex is authoritative; the LLM's phrase counts only when it is a real quote.
  const cadence = detectCadence(input.request) ?? (out.cadence && quoted(haystack, out.cadence) ? out.cadence.trim() : null);
  if (cadence) {
    const asked = decisions.findIndex((d) => /schedul|cron|host|where .* run/i.test(d.question));
    if (asked >= 0) decisions.splice(asked, 1);
    decisions.unshift(schedulerDecision(cadence));
    if (decisions.length > 3) decisions.length = 3;
    if (!spans.some((s) => s.kind === "cadence")) spans.push({ id: `S${spans.length + 1}`, text: cadence, kind: "cadence" });
    const span = spans.find((s) => s.kind === "cadence")!;
    if (!criteria.some((c) => c.span_ids.includes(span.id))) addCriterion(`The task runs on the stated cadence (${cadence}) without a person starting it.`, [span.id], "explicit");
  }

  return {
    request: input.request,
    attachments: input.attachments,
    summary: out.summary.trim() || input.request.slice(0, 200),
    spans,
    criteria,
    decisions,
    environment: {
      executor: input.executor,
      os: out.environment.os.trim() || null,
      tools_present: out.environment.tools_present.map((t) => t.trim()).filter(Boolean).slice(0, 20),
      notes: out.environment.notes.map((t) => t.trim()).filter(Boolean).slice(0, 10),
    },
    out_of_scope: out.out_of_scope.map((t) => t.trim()).filter(Boolean).slice(0, 10),
    cadence,
  };
}
