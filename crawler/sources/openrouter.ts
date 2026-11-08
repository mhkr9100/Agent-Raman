// OpenRouter model catalog: every model reachable THROUGH OpenRouter (distinct capability from direct provider access).
// Endpoint: GET https://openrouter.ai/api/v1/models — no auth.
//   Docs: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties.md (verified_on 2026-11-08)
//   - output_modalities defaults to "text" (461 models); "all" returns every model incl. image, embeddings, rerank,
//     speech, transcription, video, decisions (705 on 2026-11-08).
//   - offset/limit pagination (limit max 1000); the response carries total_count and links.next.
//   - pricing values are USD per token as strings; "-1" means variable (routers such as openrouter/auto).
// No documented rate limit for this endpoint; we page politely (minIntervalMs 1000, ≤4 requests per crawl).
// No incremental filter exists, so every crawl is a full crawl (cursor null).
import { fetchJson, trimRaw } from "../http";
import { modelSlug } from "../slug";
import { categorize, type Category } from "../taxonomy";
import type { SourceAdapter, SourceRecord } from "../types";

const BASE = "https://openrouter.ai";
const PAGE = 200;

interface OpenRouterModel {
  id: string;
  canonical_slug?: string | null;
  hugging_face_id?: string | null;
  name?: string | null;
  created?: number | null;
  description?: string | null;
  context_length?: number | null;
  architecture?: {
    modality?: string | null;
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
    tokenizer?: string | null;
    instruct_type?: string | null;
  } | null;
  pricing?: Record<string, unknown> | null;
  top_provider?: { context_length?: number | null; max_completion_tokens?: number | null; is_moderated?: boolean | null } | null;
  supported_parameters?: string[] | null;
  knowledge_cutoff?: string | null;
  expiration_date?: string | null;
  reasoning?: { mandatory?: boolean } | null;
  benchmarks?: { artificial_analysis?: Record<string, number | null> | null } & Record<string, unknown>;
  alias_target?: { name?: string; slug?: string } | null;
  endpoints?: string[] | null;
}

interface ModelsResponse {
  data: OpenRouterModel[];
  total_count?: number;
  links?: { next?: string | null };
}

const PARAM_TAGS: Record<string, string> = {
  tools: "tool-call",
  tool_choice: "tool-call",
  parallel_tool_calls: "parallel-tool-calls",
  reasoning: "reasoning",
  include_reasoning: "reasoning",
  reasoning_effort: "reasoning",
  structured_outputs: "structured-output",
  response_format: "json-mode",
  web_search_options: "web-search",
  logprobs: "logprobs",
};

const OUTPUT_CATEGORIES: Record<string, Category[]> = {
  image: ["image-generation"],
  video: ["video"],
  audio: ["audio-speech"],
  speech: ["audio-speech"],
  transcription: ["audio-speech"],
  embeddings: ["vector-search"],
  rerank: ["vector-search"],
};

/** USD-per-token string → USD per million tokens (number). Null when absent/invalid/variable (-1). */
function perMTok(v: unknown): number | null {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1e6 * 1e6) / 1e6; // strip float noise
}

function pricingOf(p: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!p) return {};
  const variable = Number(p.prompt) < 0 || Number(p.completion) < 0;
  const out: Record<string, unknown> = { currency: "USD", source_unit: "per_token" };
  if (variable) out.variable = true; // routers: price depends on the model chosen per request
  const tokenFields: Record<string, string> = {
    prompt: "prompt_usd_per_mtok",
    completion: "completion_usd_per_mtok",
    input_cache_read: "input_cache_read_usd_per_mtok",
    input_cache_write: "input_cache_write_usd_per_mtok",
    input_cache_write_1h: "input_cache_write_1h_usd_per_mtok",
    internal_reasoning: "internal_reasoning_usd_per_mtok",
  };
  for (const [k, outKey] of Object.entries(tokenFields)) {
    const v = perMTok(p[k]);
    if (v !== null) out[outKey] = v;
  }
  // Other units (per image, per search, per request, per audio token…) kept as-is in USD, numeric.
  const other: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k in tokenFields || k === "overrides") continue;
    const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0) other[`${k}_usd`] = n;
  }
  if (Object.keys(other).length) out.other = other;
  if (Array.isArray(p.overrides) && p.overrides.length) out.tiered = true; // long-context price tiers exist
  return out;
}

function toRecord(m: OpenRouterModel): SourceRecord {
  const id = m.id;
  const name = `OpenRouter · ${m.name?.trim() || id}`;
  const inMods = m.architecture?.input_modalities ?? [];
  const outMods = m.architecture?.output_modalities ?? [];
  const params = m.supported_parameters ?? [];

  const tags = new Set<string>();
  for (const p of params) if (PARAM_TAGS[p]) tags.add(PARAM_TAGS[p]);
  if (m.reasoning?.mandatory) tags.add("reasoning");
  for (const x of inMods) tags.add(`input-${x}`);
  for (const x of outMods) tags.add(`output-${x}`);
  if (inMods.includes("image")) tags.add("vision");
  if (id.endsWith(":free")) tags.add("free");
  if (id.endsWith(":batch")) tags.add("batch");
  if (m.architecture?.tokenizer === "Router") tags.add("router");
  if (m.alias_target?.slug) tags.add("alias");
  const scope_tags = [...tags];

  const desc = (m.description ?? "").trim();
  const shortDesc = desc.length > 400 ? `${desc.slice(0, 397).trimEnd()}…` : desc;
  const facts: string[] = [];
  if (m.context_length) facts.push(`Context length: ${m.context_length.toLocaleString("en-US")} tokens.`);
  if (m.alias_target?.slug) facts.push(`Alias of ${m.alias_target.slug}.`);
  const description = [shortDesc, ...facts].filter(Boolean).join(" ") || null;

  const modalityCats = outMods.flatMap((x) => OUTPUT_CATEGORIES[x] ?? []);
  // "context" (as in context length) appears in most model blurbs and trips the memory-knowledge rule; drop it here.
  const textCats = categorize(`${m.name ?? id} ${desc}`, scope_tags.filter((t) => !/^(input|output)-/.test(t)), 8).filter((c) => c !== "memory-knowledge");
  const categories = [...new Set<Category>(["ai-models", ...modalityCats, ...textCats])].slice(0, 5);

  const expired = m.expiration_date ? Date.parse(m.expiration_date) < Date.now() : false;
  const aa = m.benchmarks?.artificial_analysis;
  const quality: Record<string, unknown> = {};
  if (m.expiration_date) quality.expiration_date = m.expiration_date;
  if (m.knowledge_cutoff) quality.knowledge_cutoff = m.knowledge_cutoff;
  if (m.top_provider?.is_moderated != null) quality.is_moderated = m.top_provider.is_moderated;
  if (m.top_provider?.max_completion_tokens) quality.max_completion_tokens = m.top_provider.max_completion_tokens;
  if (m.context_length) quality.context_length = m.context_length;
  if (m.created) quality.created = new Date(m.created * 1000).toISOString();
  if (aa) {
    for (const [k, v] of Object.entries(aa)) if (typeof v === "number") quality[`artificial_analysis_${k}`] = v;
  }

  const pageUrl = `${BASE}/${id}`;
  return {
    slug: modelSlug("openrouter", id),
    kind: "model",
    name,
    description,
    publisher: id.split("/")[0]?.replace(/^~/, "") || null,
    homepage_url: pageUrl,
    repo_url: m.hugging_face_id ? `https://huggingface.co/${m.hugging_face_id}` : null,
    docs_url: "https://openrouter.ai/docs/quickstart",
    categories,
    scope_tags,
    clients_supported: ["any"],
    runtime_compat: ["executor_session", "scheduled_host"],
    install: { ai_sdk: "npm i @openrouter/ai-sdk-provider" },
    auth: { env: ["OPENROUTER_API_KEY"], obtain_url: "https://openrouter.ai/keys", oauth_pkce: true },
    // Zero prompt/completion alone does not mean free (rerank/decisions bill elsewhere); trust only the :free variant.
    pricing: { ...pricingOf(m.pricing), ...(id.endsWith(":free") ? { free: true } : {}) },
    quality,
    status: expired ? "deprecated" : "active",
    source_id: id,
    source_url: pageUrl,
    raw: trimRaw(m),
  };
}

export const openrouterAdapter: SourceAdapter = {
  name: "openrouter",
  curated: false,
  docs: {
    url: "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties.md",
    verified_on: "2026-11-08",
  },
  async *fetch(ctx) {
    let url: string | null = `${BASE}/api/v1/models?output_modalities=all&offset=0&limit=${PAGE}`;
    let yielded = 0;
    const visited = new Set<string>();
    while (url && !visited.has(url)) {
      visited.add(url);
      const res: ModelsResponse = await fetchJson<ModelsResponse>(url, { minIntervalMs: 1000 });
      const items = (res.data ?? []).filter((m) => m && typeof m.id === "string" && m.id.trim());
      ctx.log(`page ${url.split("?")[1]}: ${items.length} models (total ${res.total_count ?? "?"})`);
      if (!items.length) break;
      let batch = items.map(toRecord);
      if (ctx.limit) batch = batch.slice(0, Math.max(0, ctx.limit - yielded));
      if (batch.length) {
        yielded += batch.length;
        yield batch;
      }
      if (ctx.limit && yielded >= ctx.limit) break;
      const next = res.links?.next;
      url = next ? new URL(next, BASE).toString() : null;
    }
    return null; // no incremental filter on this endpoint: always a full crawl
  },
};
