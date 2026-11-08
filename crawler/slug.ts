// Canonical slugs so the same item from two sources merges into one capability row.
// Rule: anything hosted on GitHub is keyed by its repo path (plus subfolder for monorepos);
// otherwise by the source's own stable id.

/** "https://github.com/Owner/Repo.git" / ".../tree/main/src/x" → "github.com/owner/repo[/src/x]". Null if not GitHub. */
export function githubPath(url: string | null | undefined, subfolder?: string | null): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.replace(/^git\+/, "").replace(/^git@github\.com:/, "https://github.com/"));
  } catch {
    return null;
  }
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
  const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo, kind, , ...rest] = parts; // kind = tree|blob, then branch
  const sub = subfolder?.replace(/^\/+|\/+$/g, "") || ((kind === "tree" || kind === "blob") ? rest.join("/") : "");
  return ["github.com", owner, repo, sub].filter(Boolean).join("/").toLowerCase();
}

const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

export const mcpSlug = (repoUrl: string | null | undefined, subfolder: string | null | undefined, fallbackId: string) =>
  `mcp:${githubPath(repoUrl, subfolder) ?? clean(fallbackId)}`;

export const skillSlug = (repoUrl: string | null | undefined, subfolder: string | null | undefined, fallbackId: string) =>
  `skill:${githubPath(repoUrl, subfolder) ?? clean(fallbackId)}`;

export const pluginSlug = (marketplace: string, name: string) => `plugin:${clean(marketplace)}/${clean(name)}`;

/** Provider-scoped model id, e.g. model:anthropic/claude-opus-5-5 or model:openrouter/anthropic/claude-opus-5.5 */
export const modelSlug = (provider: string, modelId: string) => `model:${clean(provider)}/${clean(modelId)}`;
