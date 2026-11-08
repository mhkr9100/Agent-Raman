// Polite JSON fetch for crawler adapters: retries with backoff, honours Retry-After on 429/503,
// identifies itself, and never sends user data.

const UA = "agent-raman-crawler/0.1 (+https://github.com/mhkr9100)";

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  retries?: number;
  /** Minimum delay between calls to the same host, in ms. */
  minIntervalMs?: number;
}

const lastCall = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { headers = {}, retries = 3, minIntervalMs = 250 } = opts;
  const host = new URL(url).host;

  for (let attempt = 0; ; attempt++) {
    const wait = (lastCall.get(host) ?? 0) + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());

    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    if (res.ok) return (await res.json()) as T;

    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
}

export async function fetchText(url: string, opts: FetchJsonOptions = {}): Promise<string> {
  const { headers = {}, retries = 3 } = opts;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers } }).catch((e) => e as Error);
    if (res instanceof Response && res.ok) return res.text();
    if (attempt >= retries) {
      throw new Error(`GET ${url} failed: ${res instanceof Response ? res.status : res.message}`);
    }
    await sleep(1000 * 2 ** attempt);
  }
}

/** Trim a raw payload before storing it (capability_source.raw): drop huge strings/arrays.
 *  Kept small on purpose — raw is for debugging, the normalized columns are the product (500 MB free tier). */
export function trimRaw(value: unknown, maxString = 300, maxArray = 10): unknown {
  if (typeof value === "string") return value.length > maxString ? value.slice(0, maxString) + "…" : value;
  if (Array.isArray(value)) return value.slice(0, maxArray).map((v) => trimRaw(v, maxString, maxArray));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimRaw(v, maxString, maxArray)]));
  }
  return value;
}
