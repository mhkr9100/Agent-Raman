// models.dev model catalog (data MIT-licensed) → one `model` capability per provider-served model.
// Endpoint: GET https://models.dev/api.json — map of provider id → { id, name, npm, env, doc, api?, models: { <id>: {...} } }.
// Field reference: README "API Reference" at https://github.com/anomalyco/models.dev (verified_on 2026-11-08).
// One unauthenticated ~6 MB JSON file, served from Cloudflare cache; no documented rate limit, we make a single call.
// Pages: https://models.dev/models/<lab>/<model> (lab model page) and https://models.dev/providers/<provider>.
import { fetchJson, trimRaw } from "../http";
import { modelSlug } from "../slug";
import { categorize } from "../taxonomy";
import type { SourceAdapter, SourceRecord } from "../types";

const API_URL = "https://models.dev/api.json";
const SITE = "https://models.dev";
const BATCH = 200;

interface MdProvider {
  id: string;
  name: string;
  npm?: string;
  env?: string[];
  doc?: string;
  api?: string;
  models: Record<string, MdModel>;
}

interface MdModel {
  id: string;
  name: string;
  description?: string;
  family?: string;
  /** Specialized behaviour: image, embedding, video, speech, transcription, reranking, realtime, chat… */
  type?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: { input?: string[]; output?: string[] };
  open_weights?: boolean;
  limit?: { context?: number; input?: number; output?: number };
  /** USD per 1M tokens; may carry `tiers` and `context_over_200k`. */
  cost?: Record<string, unknown>;
  /** Lab/model id this provider entry is based on, e.g. "openai/gpt-5". */
  canonical_model_id?: string;
  status?: "alpha" | "beta" | "deprecated";
  /** Per-model override of the provider's SDK package / base URL. */
  provider?: { npm?: string; api?: string };
  experimental?: { modes?: Record<string, { cost?: Record<string, unknown> }> };
}

// npm package name (optionally scoped); anything else is not turned into a command.
const NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const fmt = (n: number) => n.toLocaleString("en-US");
const NON_TEXT = (xs: string[] | undefined) => (xs ?? []).filter((x) => x !== "text");

/** Facts only (modalities, limits, capability flags, weights, dates) — the source's own blurb stays in raw. */
function describe(m: MdModel): string {
  const out: string[] = [];
  if (m.type) out.push(`${m.type[0].toUpperCase()}${m.type.slice(1)} model.`);
  const inp = m.modalities?.input ?? [];
  const outp = m.modalities?.output ?? [];
  if (inp.length || outp.length) out.push(`Input: ${inp.join(", ") || "n/a"}; output: ${outp.join(", ") || "n/a"}.`);
  const lim: string[] = [];
  if (m.limit?.context) lim.push(`${fmt(m.limit.context)}-token context`);
  if (m.limit?.input) lim.push(`${fmt(m.limit.input)}-token max input`);
  if (m.limit?.output) lim.push(`${fmt(m.limit.output)}-token max output`);
  if (lim.length) out.push(`${lim.join(", ")}.`);
  const yes = [m.tool_call && "tool calling", m.reasoning && "reasoning", m.structured_output && "structured output",
    m.attachment && "file attachments"].filter(Boolean);
  if (yes.length) out.push(`Supports ${yes.join(", ")}.`);
  if (m.tool_call === false) out.push("No tool calling.");
  if (typeof m.open_weights === "boolean") out.push(m.open_weights ? "Open weights." : "Closed weights.");
  const dates = [m.release_date && `released ${m.release_date}`, m.knowledge && `knowledge cutoff ${m.knowledge}`].filter(Boolean);
  if (dates.length) out.push(`${dates.join("; ").replace(/^./, (c) => c.toUpperCase())}.`);
  if (m.status) out.push(`Status: ${m.status}.`);
  return out.join(" ");
}

function scopeTags(m: MdModel): string[] {
  const tags = new Set<string>();
  if (m.tool_call) tags.add("tool-call");
  if (m.reasoning) tags.add("reasoning");
  if (m.structured_output) tags.add("structured-output");
  if (m.open_weights) tags.add("open-weights");
  for (const x of NON_TEXT(m.modalities?.input)) tags.add(`${x}-input`);
  for (const x of NON_TEXT(m.modalities?.output)) tags.add(`${x}-output`);
  if (m.type) tags.add(m.type);
  return [...tags];
}

// Name-only matches that mislabel models: "Chat" (gpt-5-chat), "(Cloudflare)" host suffix, "Note", "QA", "Route".
const NAME_NOISE = new Set(["communication", "devops-cloud", "memory-knowledge", "testing-qa", "maps-location"]);

/**
 * 'ai-models' always, plus taxonomy hits from the name and modality/type phrases.
 * The facts description is NOT fed to categorize(): "tool calling" / "context" in it would tag every
 * model agents-orchestration / memory-knowledge.
 */
function categories(m: MdModel): string[] {
  const inp = m.modalities?.input ?? [];
  const outp = m.modalities?.output ?? [];
  const phrases: string[] = [];
  if (outp.includes("image") || m.type === "image") phrases.push("image generation");
  if (inp.includes("audio") || outp.includes("audio")) phrases.push("audio");
  if (m.type === "speech") phrases.push("text-to-speech");
  if (m.type === "transcription") phrases.push("transcription");
  // Video only when generated (like image); video/pdf *input* stays a scope tag, else most frontier models
  // would land in video/documents.
  if (outp.includes("video") || m.type === "video") phrases.push("video");
  if (m.type === "embedding") phrases.push("embeddings");
  if (m.type === "reranking") phrases.push("semantic search");
  const hits = categorize(`${m.name} ${m.family ?? ""}`, phrases, 4).filter((c) => !NAME_NOISE.has(c));
  return [...new Set<string>(["ai-models", ...hits])];
}

function pricing(m: MdModel): Record<string, unknown> | undefined {
  const modes = m.experimental?.modes;
  const modeCosts = modes
    ? Object.fromEntries(Object.entries(modes).filter(([, v]) => v?.cost).map(([k, v]) => [k, v.cost]))
    : {};
  if (!m.cost || !Object.keys(m.cost).length) return undefined;
  return {
    ...m.cost,
    ...(Object.keys(modeCosts).length ? { modes: modeCosts } : {}),
    currency: "USD",
    unit: "per 1M tokens",
  };
}

function toRecord(p: MdProvider, modelKey: string, m: MdModel): SourceRecord {
  const modelId = m.id || modelKey;
  // Some entries name a subpath import (e.g. "@ai-sdk/google-vertex/anthropic"); install the package itself.
  const npmSpec = m.provider?.npm ?? p.npm;
  const npm = npmSpec?.startsWith("@") ? npmSpec.split("/").slice(0, 2).join("/") : npmSpec?.split("/")[0];
  const tags = scopeTags(m);
  return {
    slug: modelSlug(p.id, modelId),
    kind: "model",
    name: `${p.name} · ${m.name || modelId}`,
    description: describe(m) || null,
    publisher: p.name,
    docs_url: p.doc ?? null,
    categories: categories(m),
    scope_tags: tags,
    clients_supported: ["any"],
    runtime_compat: ["executor_session", "scheduled_host"],
    install: npm && NPM_NAME.test(npm) ? { ai_sdk: `npm i ${npm}` } : undefined,
    auth: p.env?.length ? { env: p.env } : undefined,
    pricing: pricing(m),
    quality: {
      lifecycle: m.status ?? null,
      release_date: m.release_date ?? null,
      last_updated: m.last_updated ?? null,
      knowledge: m.knowledge ?? null,
    },
    status: m.status === "deprecated" ? "deprecated" : "active",
    source_id: `${p.id}/${modelId}`,
    source_url: m.canonical_model_id
      ? `${SITE}/models/${m.canonical_model_id}`
      : `${SITE}/providers/${encodeURIComponent(p.id)}`,
    raw: trimRaw({
      provider: { id: p.id, name: p.name, npm: p.npm, env: p.env, doc: p.doc, api: p.api },
      model: m,
    }),
  };
}

export const modelsDevAdapter: SourceAdapter = {
  name: "models_dev",
  curated: false,
  docs: { url: "https://github.com/anomalyco/models.dev", verified_on: "2026-11-08" },

  async *fetch(ctx) {
    const data = await fetchJson<Record<string, MdProvider>>(API_URL, { minIntervalMs: 1000 });
    const providers = Object.entries(data);
    ctx.log(`${providers.length} providers`);

    let yielded = 0;
    let batch: SourceRecord[] = [];
    for (const [providerKey, raw] of providers) {
      if (!raw || typeof raw !== "object" || !raw.models) continue;
      const p: MdProvider = { ...raw, id: raw.id || providerKey, name: raw.name || providerKey };
      for (const [modelKey, m] of Object.entries(p.models)) {
        if (!m || typeof m !== "object") continue;
        batch.push(toRecord(p, modelKey, m));
        if (ctx.limit && yielded + batch.length >= ctx.limit) {
          yield batch;
          return null;
        }
        if (batch.length >= BATCH) {
          yield batch;
          yielded += batch.length;
          batch = [];
        }
      }
    }
    if (batch.length) yield batch;
    return null; // single snapshot file, no incremental sync
  },
};
