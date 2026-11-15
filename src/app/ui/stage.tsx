"use client";
// The main page: one prompt box over the prism picture (scatter.tsx). The picture is the progress display; this
// file adds the few words and controls it needs. When the run is done the screen flashes white once and the
// task file appears in the middle; clicking it downloads task.md.
// The model key stays in the browser (sessionStorage, or localStorage when the user asks) and travels only in
// the header of each step call (api.ts).
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, type RunView, type Settings } from "./api";
import Scatter, { type Mode, type Ray } from "./scatter";

// Mirrors PROVIDERS in src/lib/llm.ts. Claude model ids:
// https://docs.claude.com/en/docs/about-claude/models/overview (verified_on 2026-11-10).
const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"], hint: "claude-sonnet-5-5" },
  { id: "openai", name: "OpenAI", models: [], hint: "The model id from your OpenAI account" },
  { id: "google", name: "Google", models: [], hint: "The model id from Google AI Studio" },
  { id: "openrouter", name: "OpenRouter", models: [], hint: "vendor/model" },
  { id: "openai_compatible", name: "OpenAI-compatible", models: [], hint: "The model id your endpoint serves" },
];
const EXECUTORS = [
  { id: "claude_code", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "chatgpt", name: "ChatGPT" },
  { id: "cursor", name: "Cursor" },
];
const MAX_REQUEST = 20_000;
// What the visitor is told while it works. One line per stage, nothing about how a stage works inside.
const CAPTION: Record<string, string> = {
  intake: "Reading your request",
  decisions: "Waiting for your answer",
  expand: "Scattering into needs",
  obstacles: "Looking for what could block it",
  critic: "Checking for gaps",
  finalize: "Writing task.md",
};
const NONE: Ray[] = [];

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noSubscribe = () => () => {};

function read<T>(store: () => Storage, key: string, fallback: T): T {
  try {
    const v = store().getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function loadSettings(): Settings {
  const s = read<Partial<Settings>>(() => localStorage, "raman.settings", {});
  let key = "";
  try { key = (s.remember ? localStorage : sessionStorage).getItem("raman.key") ?? ""; } catch {}
  return { provider: s.provider ?? "anthropic", model: s.model ?? "", baseURL: s.baseURL ?? "", key, remember: !!s.remember };
}
function saveSettings(s: Settings) {
  try {
    localStorage.setItem("raman.settings", JSON.stringify({ provider: s.provider, model: s.model, baseURL: s.baseURL, remember: s.remember }));
    (s.remember ? localStorage : sessionStorage).setItem("raman.key", s.key);
    (s.remember ? sessionStorage : localStorage).removeItem("raman.key");
  } catch {}
}

export default function Stage() {
  // Settings come from browser storage, so the live page is mounted only in the browser.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  return hydrated ? <Live /> : null;
}

function Live() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [request, setRequest] = useState("");
  const [executor, setExecutor] = useState("claude_code");
  const [run, setRun] = useState<RunView | null>(null);
  const [busy, setBusy] = useState<"" | "creating" | "driving">("");
  const [halting, setHalting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showModel, setShowModel] = useState(false);
  const [fx, setFx] = useState<"" | "burst" | "flash">("");
  const [revealed, setRevealed] = useState(false);
  const stop = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    // A link with #run=<id> reopens that run: a finished one shows its file, without the flash.
    const id = /^#run=([0-9a-f-]{36})$/i.exec(window.location.hash)?.[1];
    if (id) {
      api.get(id)
        .then((r) => { setRun(r); if (r.status === "done") setRevealed(true); })
        .catch(() => setError("That run no longer exists on the server."));
    }
    const pending = timers.current;
    return () => { stop.current = true; pending.forEach((t) => window.clearTimeout(t)); };
  }, []);

  const leaves = useMemo<Ray[]>(
    () => (run ? run.nodes.filter((n) => n.parent_id && n.status !== "split").map((n) => ({ id: n.id, status: n.status })) : NONE),
    [run],
  );
  const provider = PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0];
  const modelReady = settings.model.trim().length > 0 && settings.key.trim().length >= 8
    && (settings.provider !== "openai_compatible" || settings.baseURL.trim().startsWith("http"));
  const done = run?.status === "done";
  const ended = !!run && (run.status === "failed" || run.status === "cancelled");
  const asking = !!run && !done && !ended && !busy && run.beam.decisions.some((d) => !d.answer) && run.phase === "decisions";
  const mode: Mode = fx && !revealed ? "burst" : !run ? "idle" : done ? "done" : busy ? "running" : "paused";

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  function celebrate() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setRevealed(true); return; }
    const at = (ms: number, f: () => void) => { timers.current.push(window.setTimeout(f, ms)); };
    setFx("burst"); // the beam swells,
    at(450, () => setFx("flash")); // the screen goes white,
    at(950, () => setRevealed(true)); // the file is put in place while it is white,
    at(2600, () => setFx("")); // and the white is gone.
  }

  async function drive(id: string) {
    stop.current = false;
    setHalting(false);
    setBusy("driving");
    setError(null);
    try {
      for (let i = 0; i < 500 && !stop.current; i++) {
        const s = await api.step(id, settings);
        setRun(await api.get(id));
        if (s.error) { setError(s.error); break; }
        if (s.busy) { await sleep(2500); continue; }
        if (s.status === "done") { celebrate(); break; }
        if (s.status !== "running" || s.awaiting) break;
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
      setHalting(false);
    }
  }

  async function start() {
    const text = request.trim();
    if (!text || busy) return;
    if (!modelReady) {
      setShowModel(true);
      setNotice("AgentRamaN thinks with your own model. Add the model and its key first.");
      return;
    }
    setBusy("creating");
    setShowModel(false);
    setError(null);
    setNotice(null);
    try {
      const made = await api.create(settings, { request: text, executor, preset: "standard", attachments: [], keep_text: false });
      window.history.replaceState(null, "", `#run=${made.id}`);
      if (made.secrets_removed) setNotice(`${made.secrets_removed} key-like string${made.secrets_removed === 1 ? " was" : "s were"} removed from your request before anything was stored. Refer to credentials by name.`);
      setRun(await api.get(made.id));
      await drive(made.id);
    } catch (e) {
      setError(message(e));
      setBusy("");
    }
  }

  async function decide(answers: Record<string, string>) {
    if (!run) return;
    try {
      await api.decide(run.id, answers);
      setRun(await api.get(run.id));
      await drive(run.id);
    } catch (e) {
      setError(message(e));
    }
  }

  function reset() {
    stop.current = true;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setRun(null);
    setRevealed(false);
    setFx("");
    setError(null);
    setNotice(null);
    setRequest("");
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function remove() {
    if (!run) return;
    stop.current = true;
    try { await api.remove(run.id); } catch (e) { setError(message(e)); return; }
    reset();
  }

  return (
    <>
      <Scatter rays={leaves} mode={mode} phase={run?.phase ?? ""} />
      {fx === "flash" && <div aria-hidden className="flash pointer-events-none fixed inset-0 z-50 bg-white" />}

      {done && revealed && run && <TaskFile run={run} leaves={leaves} onNew={reset} onDelete={remove} />}
      {asking && run && <Decisions run={run} onDecide={decide} />}

      <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-4 pb-5 sm:pb-7">
        {notice && <p role="status" className="max-w-xl text-center text-xs text-stokes">{notice}</p>}
        {error && <p role="alert" className="max-w-xl text-center text-sm text-gap">{error}</p>}

        {!run && (
          <form className="relative w-full max-w-2xl" onSubmit={(e) => { e.preventDefault(); void start(); }}>
            {showModel && <ModelCard settings={settings} provider={provider} update={update} onClose={() => { setShowModel(false); setNotice(null); }} />}
            <div className="rounded-2xl border border-rule bg-panel/85 shadow-[0_0_60px_-20px_rgba(63,224,160,0.35)] backdrop-blur transition-colors focus-within:border-laser/60">
              <label htmlFor="ask" className="sr-only">Describe the task for your AI agent</label>
              <textarea
                id="ask" rows={1} autoFocus value={request} maxLength={MAX_REQUEST} disabled={!!busy}
                placeholder="Describe a task for your AI agent"
                className="bare block max-h-44 w-full resize-none bg-transparent px-4 pb-1 pt-4 text-base leading-relaxed placeholder:text-faint"
                onChange={(e) => {
                  setRequest(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void start(); }
                }}
              />
              <div className="flex items-center gap-2 px-3 pb-3 pt-1">
                <label htmlFor="executor" className="sr-only">The agent that will run the task</label>
                <select id="executor" className="chip" value={executor} onChange={(e) => setExecutor(e.target.value)}>
                  {EXECUTORS.map((x) => <option key={x.id} value={x.id}>for {x.name}</option>)}
                </select>
                <button type="button" className="chip" aria-expanded={showModel} onClick={() => setShowModel(!showModel)}>
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${modelReady ? "bg-laser" : "bg-stokes"}`} />
                  {modelReady ? settings.model.trim() : "add your model key"}
                </button>
                <span className="flex-1" />
                <button type="submit" className="btn btn-primary h-9 w-9 rounded-full p-0" disabled={!request.trim() || !!busy} aria-label="Start">
                  <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            </div>
          </form>
        )}

        {run && !done && (
          <div className="flex w-full max-w-xl flex-col items-center gap-3 text-center">
            <p aria-live="polite" className="font-display text-2xl sm:text-3xl">
              {ended ? "This run stopped" : busy ? `${CAPTION[run.phase] ?? "Working"}…` : asking ? CAPTION.decisions : "Paused"}
            </p>
            <Counts leaves={leaves} />
            <div className="flex flex-wrap items-center justify-center gap-2">
              {busy === "driving" && <button type="button" className="btn btn-quiet" disabled={halting} onClick={() => { stop.current = true; setHalting(true); }}>{halting ? "Stopping after this step…" : "Stop"}</button>}
              {!busy && !ended && !asking && <button type="button" className="btn btn-primary" disabled={!modelReady} onClick={() => void drive(run.id)}>Continue</button>}
              {!busy && !ended && !asking && !modelReady && <button type="button" className="btn btn-quiet" onClick={() => setShowModel(!showModel)}>Add your model key</button>}
              {!busy && <button type="button" className="btn btn-quiet" onClick={ended ? reset : () => void remove()}>{ended ? "New task" : "Delete this run"}</button>}
            </div>
            {showModel && !busy && (
              <div className="relative w-full text-left">
                <ModelCard settings={settings} provider={provider} update={update} onClose={() => setShowModel(false)} />
              </div>
            )}
          </div>
        )}

        <p className="text-center font-mono text-[11px] text-faint xl:hidden">v2.0 · AgentRamaN – Multi · coming soon</p>
      </div>

      <aside aria-label="Use it in your own tools" className="fixed bottom-7 left-6 z-10 hidden w-56 xl:block">
        <p className="label">Use it in your own tools</p>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
          {["MCP server", "HTTP API", "Skill"].map((x) => (
            <li key={x} className="flex items-center justify-between border-b border-rule/60 pb-1">
              <span>{x}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">soon</span>
            </li>
          ))}
        </ul>
        <Link href="/docs" className="mt-2 inline-block text-xs text-muted underline decoration-rule underline-offset-4 hover:text-text">How it will work</Link>
        <p className="mt-5 font-mono text-[11px] text-faint">v2.0 · AgentRamaN – Multi · coming soon</p>
      </aside>
    </>
  );
}

function Counts({ leaves }: { leaves: Ray[] }) {
  const n = (...s: string[]) => leaves.filter((l) => s.includes(l.status)).length;
  const items = [
    { n: n("bound", "low_confidence"), label: "bound", dot: "bg-laser" },
    { n: n("build"), label: "to build", dot: "bg-stokes" },
    { n: n("human"), label: "need you", dot: "bg-person" },
    { n: n("unresolved", "unverified"), label: "unresolved", dot: "bg-gap" },
  ];
  if (!leaves.length) return null;
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${i.dot}`} />
          {i.n} {i.label}
        </li>
      ))}
    </ul>
  );
}

function ModelCard({ settings, provider, update, onClose }: {
  settings: Settings; provider: (typeof PROVIDERS)[number]; update: (patch: Partial<Settings>) => void; onClose: () => void;
}) {
  return (
    <div role="group" aria-label="Your model" className="absolute inset-x-0 bottom-full z-30 mb-3 max-h-[calc(100dvh-12rem)] overflow-y-auto rounded-2xl border border-rule bg-panel p-4 shadow-2xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="label">Provider</span>
          <select className="field" value={settings.provider} onChange={(e) => update({ provider: e.target.value, model: "" })}>
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Model</span>
          <input className="field" list="models" value={settings.model} placeholder={provider.hint} maxLength={120} autoComplete="off" spellCheck={false}
            onChange={(e) => update({ model: e.target.value })} />
          <datalist id="models">{provider.models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        {settings.provider === "openai_compatible" && (
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="label">Base URL</span>
            <input className="field" type="url" value={settings.baseURL} placeholder="https://your-endpoint/v1" maxLength={300} autoComplete="off" spellCheck={false}
              onChange={(e) => update({ baseURL: e.target.value })} />
          </label>
        )}
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="label">API key</span>
          <input className="field font-mono" type="password" value={settings.key} placeholder="Your provider key" maxLength={400} autoComplete="off" spellCheck={false}
            onChange={(e) => update({ key: e.target.value })} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={settings.remember} onChange={(e) => update({ remember: e.target.checked })} />
          Keep the key on this device
        </label>
        <button type="button" className="btn btn-quiet px-3 py-1.5 text-xs" onClick={onClose}>Done</button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        The key stays in this browser. It is sent with each step so your own model can do the thinking, and it is never stored or logged on the server.
      </p>
    </div>
  );
}

function Decisions({ run, onDecide }: { run: RunView; onDecide: (answers: Record<string, string>) => Promise<void> }) {
  const open = run.beam.decisions.filter((d) => !d.answer);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(open.map((d) => [d.id, d.default])));
  const [sending, setSending] = useState(false);
  const send = async (a: Record<string, string>) => {
    setSending(true);
    await onDecide(a);
    setSending(false);
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-ink/70 p-4 backdrop-blur-sm">
      <form role="dialog" aria-modal="true" aria-labelledby="ask-title" className="appear my-auto w-full max-w-lg rounded-2xl border border-laser/50 bg-panel p-5 shadow-2xl"
        onSubmit={(e) => { e.preventDefault(); void send(answers); }}>
        <h2 id="ask-title" className="font-display text-2xl">{open.length === 1 ? "One question only you can answer" : `${open.length} questions only you can answer`}</h2>
        <div className="mt-4 flex flex-col gap-5">
          {open.map((d) => (
            <fieldset key={d.id}>
              <legend className="text-sm font-medium">{d.question}</legend>
              {d.why && <p className="mt-1 text-xs text-muted">{d.why}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {d.options.map((o) => (
                  <label key={o} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${answers[d.id] === o ? "border-laser bg-laser/10" : "border-rule text-muted hover:border-muted"}`}>
                    <input type="radio" className="sr-only" name={d.id} checked={answers[d.id] === o} onChange={() => setAnswers({ ...answers, [d.id]: o })} />
                    {o}
                    {o === d.default && <span className="ml-1.5 font-mono text-[10px] text-faint">default</span>}
                  </label>
                ))}
              </div>
              <input className="field mt-2" aria-label={`Your own answer to: ${d.question}`} placeholder="Or write your own answer" maxLength={300}
                value={d.options.includes(answers[d.id] ?? "") ? "" : answers[d.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [d.id]: e.target.value })} />
            </fieldset>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? "Continuing…" : "Answer and continue"}</button>
          <button type="button" className="btn btn-quiet" disabled={sending} onClick={() => void send({})}>Use the defaults</button>
        </div>
        <p className="mt-3 text-xs text-muted">A default you do not confirm is written into the task file as an assumption.</p>
      </form>
    </div>
  );
}

function TaskFile({ run, leaves, onNew, onDelete }: { run: RunView; leaves: Ray[]; onNew: () => void; onDelete: () => void }) {
  const [rated, setRated] = useState(0);
  const rate = (n: number) => {
    setRated(n);
    api.feedback(run.id, { rating: n }).catch(() => setRated(0));
  };
  return (
    <div className="appear fixed left-1/2 top-[43%] z-30 flex w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4 text-center">
      <a href={`/api/runs/${run.id}/task.md?download=1`} download="task.md" className="file group flex flex-col items-center gap-3 rounded-2xl p-3" aria-label="Download task.md">
        <svg aria-hidden width="132" height="164" viewBox="0 0 132 164" fill="none">
          <path d="M10 2h78l34 34v118a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8V10a8 8 0 0 1 8-8Z" fill="#f4f2ec" stroke="#ffffff" strokeWidth="2" />
          <path d="M88 2v26a8 8 0 0 0 8 8h26" fill="#dcd9cf" />
          <rect x="20" y="52" width="58" height="6" rx="3" fill="#090b0f" opacity="0.8" />
          <rect x="20" y="72" width="88" height="5" rx="2.5" fill="#3fe0a0" />
          <rect x="20" y="87" width="74" height="5" rx="2.5" fill="#f3b54a" />
          <rect x="20" y="102" width="82" height="5" rx="2.5" fill="#9db0ff" />
          <rect x="20" y="117" width="46" height="5" rx="2.5" fill="#ff6a5c" />
          <rect x="20" y="136" width="66" height="4" rx="2" fill="#090b0f" opacity="0.25" />
        </svg>
        <span className="font-mono text-sm text-text">task.md</span>
        <span className="text-xs text-muted group-hover:text-text">Click to download</span>
      </a>
      <Counts leaves={leaves} />
      <div className="flex items-center gap-2 text-xs text-muted" role="group" aria-label="Was it useful? 1 is no, 5 is yes">
        <span>Useful?</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-pressed={rated === n} onClick={() => rate(n)}
            className={`h-6 w-6 rounded-full border font-mono text-[11px] ${rated === n ? "border-laser bg-laser/15 text-text" : "border-rule hover:border-muted"}`}>
            {n}
          </button>
        ))}
        {rated > 0 && <span role="status">Thanks.</span>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" className="btn btn-quiet px-3 py-1.5 text-xs" onClick={onNew}>New task</button>
        <button type="button" className="btn btn-quiet px-3 py-1.5 text-xs" onClick={onDelete}>Delete this run</button>
      </div>
    </div>
  );
}
