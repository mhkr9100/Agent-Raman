// Shared pieces of the API routes: JSON replies, body limits, the per-request model, and a small rate limit.
// Server only.
import type { LanguageModel } from "ai";
import { languageModel, PROVIDERS, type Provider } from "./llm";
import { redact } from "./prism/ask";
import { publicHttpsUrl } from "./prism/critic";
import { InputError } from "./prism/engine";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Reads a JSON body with a size cap (characters). */
export async function readJson(req: Request, maxChars = 300_000): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxChars * 4) throw new HttpError(413, "Request body is too large.");
  const text = await req.text();
  if (text.length > maxChars) throw new HttpError(413, "Request body is too large.");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
}

/** Turns anything thrown into a reply. Messages pass through `redact`, so a key can never be echoed. */
export function errorReply(e: unknown): Response {
  if (e instanceof HttpError) return fail(e.status, e.message);
  if (e instanceof InputError) return fail(400, e.message);
  console.error("api error:", redact(e));
  return fail(500, "Something went wrong on the server.");
}

// ── The user's model (bring your own key) ────────────────────────────────────────────────────────────────
// The key arrives in a header on each request, builds the provider here, and goes nowhere else: it is not
// stored, not logged, and not part of any error text (CLAUDE.md).

export const KEY_HEADERS = { key: "x-raman-key", provider: "x-raman-provider", model: "x-raman-model", baseURL: "x-raman-base-url" } as const;

const isProvider = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);

export function modelLabels(req: Request): { provider: Provider; model: string } {
  const provider = (req.headers.get(KEY_HEADERS.provider) ?? "").trim();
  const model = (req.headers.get(KEY_HEADERS.model) ?? "").trim();
  if (!isProvider(provider)) throw new HttpError(400, `Header ${KEY_HEADERS.provider} must be one of: ${PROVIDERS.join(", ")}.`);
  if (!/^[\w.:\/@-]{1,120}$/.test(model)) throw new HttpError(400, `Header ${KEY_HEADERS.model} must name a model.`);
  return { provider, model };
}

export async function modelFromHeaders(req: Request): Promise<{ model: LanguageModel; provider: Provider; name: string }> {
  const { provider, model } = modelLabels(req);
  const apiKey = (req.headers.get(KEY_HEADERS.key) ?? "").trim();
  if (apiKey.length < 8 || apiKey.length > 400) throw new HttpError(401, `Header ${KEY_HEADERS.key} must carry your model provider key. It is used for this request only and never stored.`);
  let baseURL: string | undefined;
  if (provider === "openai_compatible") {
    const raw = (req.headers.get(KEY_HEADERS.baseURL) ?? "").trim();
    const local = process.env.NODE_ENV === "development" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(raw);
    // The server calls this URL with the user's key, so it must be a public https host (no internal addresses).
    if (!local && !(await publicHttpsUrl(raw))) throw new HttpError(400, `Header ${KEY_HEADERS.baseURL} must be a public https URL.`);
    baseURL = raw.replace(/\/+$/, "");
  }
  return { model: languageModel({ provider, apiKey, model, baseURL }), provider, name: model };
}

// ── Rate limit ───────────────────────────────────────────────────────────────────────────────────────────
// Fixed window per client address, kept in memory. ⏳ Per server instance only: it slows a single abusive
// client, it is not a quota (docs/BACKLOG.md).

const windows = new Map<string, { start: number; count: number }>();

export function clientAddress(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** Throws 429 when `bucket` saw more than `max` requests from this client in the last `seconds`. */
export function limit(req: Request, bucket: string, max: number, seconds: number): void {
  // Local load tests only (many agents share one address). Never set on a public host.
  if (process.env.RAMAN_RATE_LIMIT === "off") return;
  const now = Date.now();
  if (windows.size > 5000) for (const [k, w] of windows) if (now - w.start > 3_600_000) windows.delete(k);
  const key = `${bucket}:${clientAddress(req)}`;
  const w = windows.get(key);
  if (!w || now - w.start > seconds * 1000) { windows.set(key, { start: now, count: 1 }); return; }
  if (++w.count > max) throw new HttpError(429, `Too many requests. Try again in ${Math.ceil((w.start + seconds * 1000 - now) / 1000)} s.`);
}
