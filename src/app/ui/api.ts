// Browser-side calls to Raman's own API. The model key lives in the browser and travels only in the
// x-raman-key header of the step call; it is never put in a URL or a body.
import type { RunView } from "@/lib/prism/store";

export type { RunView };
export type NodeView = RunView["nodes"][number];

export interface Settings { provider: string; model: string; baseURL: string; key: string; remember: boolean }
export interface StepReply { status: string; phase: string; awaiting: "decisions" | null; busy: boolean; error: string | null }
export interface NewRun { request: string; executor: string; preset: string; attachments: { name: string; text: string }[]; keep_text: boolean }

function headers(s: Settings | null, withKey = false): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (!s) return h;
  h["x-raman-provider"] = s.provider;
  h["x-raman-model"] = s.model.trim();
  if (withKey) {
    h["x-raman-key"] = s.key.trim();
    if (s.provider === "openai_compatible") h["x-raman-base-url"] = s.baseURL.trim();
  }
  return h;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `The server answered ${res.status}.`);
  return body as T;
}

export const api = {
  create: (s: Settings, run: NewRun) => call<{ id: string; secrets_removed: number }>("/api/runs", { method: "POST", headers: headers(s), body: JSON.stringify(run) }),
  get: (id: string) => call<RunView>(`/api/runs/${id}`),
  step: (id: string, s: Settings) => call<StepReply>(`/api/runs/${id}/step`, { method: "POST", headers: headers(s, true) }),
  decide: (id: string, answers: Record<string, string>) => call<StepReply>(`/api/runs/${id}/decisions`, { method: "POST", headers: headers(null), body: JSON.stringify({ answers }) }),
  feedback: (id: string, body: { rating?: number; feedback?: string }) => call<{ saved: boolean }>(`/api/runs/${id}/feedback`, { method: "POST", headers: headers(null), body: JSON.stringify(body) }),
  remove: (id: string) => call<{ deleted: boolean }>(`/api/runs/${id}`, { method: "DELETE" }),
  taskMd: async (id: string) => {
    const res = await fetch(`/api/runs/${id}/task.md`, { cache: "no-store" });
    if (!res.ok) throw new Error("The task file is not ready.");
    return res.text();
  },
};
