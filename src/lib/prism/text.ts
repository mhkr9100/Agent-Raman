// Small text helpers shared by the prism steps. All deterministic.

export const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** True when `quote` appears in `text` (whitespace- and case-insensitive). Short quotes never match. */
export function quoted(text: string, quote: string, minLen = 4): boolean {
  const q = norm(quote);
  return q.length >= minLen && norm(text).includes(q);
}

const STOP = new Set("a an the to of in on for and or with by from at as is are be it its this that into via per each then when if not no".split(" "));
export const tokens = (s: string) => new Set(norm(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)));

export function jaccard(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

export const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : "");

/** One markdown table cell: no pipes, no newlines. */
export const cell = (s: string | null | undefined, n = 200) => clip((s ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|"), n) || "—";

// Names Claude Code and common tooling treat specially; a generated placeholder must not collide with them
// (RAMAN-TASK §8, FRAMEWORK §9 item 6).
const RESERVED = /^(ANTHROPIC_.*|AWS_BEARER_TOKEN_BEDROCK|HTTPS?_PROXY|NO_PROXY|NPM_TOKEN|PATH|HOME|USER|SHELL)$/;

/** Normalises an env-var NAME (never a value). Returns null when the text is not usable as a name. */
export function envName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // A value pasted where a name belongs (long, mixed case, has = or spaces) is dropped, never stored.
  if (/[=\s]/.test(raw.trim()) || raw.length > 64) return null;
  const n = raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  if (!/^[A-Z_][A-Z0-9_]{1,63}$/.test(n)) return null;
  return RESERVED.test(n) ? `TASK_${n}` : n;
}

// Key-like strings must never reach a stored run or a generated file.
const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
export function scrubSecrets(s: string): { text: string; found: number } {
  let found = 0;
  let text = s;
  for (const re of SECRETS) text = text.replace(re, () => { found++; return "[secret removed]"; });
  return { text, found };
}
