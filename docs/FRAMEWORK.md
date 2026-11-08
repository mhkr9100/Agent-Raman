# Agent Raman — Framework v1 (design, 2026-11-08)

Raman does not do the user's task. It turns one request into a complete, verified bill of materials for an AI agent: every capability to install, the prompt, the inputs, the constraints, the checks — and a proof of what it could not resolve. One output: `task.md`. The user attaches it to Claude Code / ChatGPT and that agent has the right weapons, the right field, the right army, and nothing missed.

This document is the method. It was produced by running the method on itself (see `FRAMEWORK-BREAKS.md`). Every design claim below carries a verification mark:

- ✅ verified by independent skeptics (≥2 of 3 lenses) or fact-checked live against primary sources
- ⚠️ survived, but only with the amendment written here
- ❌ refuted → replaced by what is written here
- ⏳ not yet verified (verification run hit the session limit; queued)

---

## 1. Vocabulary (working titles, not final)

| Term | Meaning |
|---|---|
| **Beam** | The user's request as entered, plus the *spans* cut from it (every noun phrase, verb and qualifier kept verbatim, e.g. "every 30 min", "nothing missed"). |
| **Prism** | One node of the analysis tree. Every prism — root, sub, sub-sub — carries the same 7-part unit (§2). |
| **Binder** | Code (not the LLM) that matches a need to real items in the catalog and fills the Capabilities part. |
| **Gates** | Code checks over the whole tree: forward trace, category checklist, backward trace. |
| **Critic** | An LLM pass that may only *propose* gaps; the Gates decide. |
| **BoM** | The deduplicated bill-of-materials graph that becomes `task.md`. |
| **Spectral Library** | Stored past runs, used to seed and improve new ones. |
| **Executor** | The agent that will run `task.md`: Claude Code, Codex, ChatGPT, Cursor. |

The Raman-effect prism is the visual metaphor only. The technical method is goal refinement (KAOS) + bind-before-split with bounded depth (ADaPT-style, each bind a recorded coverage judgment) + catalog-grounded binding (propose-and-verify) + traceability gates + an adjudicated critic.

---

## 2. The unit — the same 7 parts in every prism

How your original components landed: *Persona/Prompt/Role* → **Instructions** (restricted, see below) · *Memory/Context* → v2, except the task's own data (**Inputs**) and the executor environment (**Constraints**) · *Capabilities* → **Capabilities** (now filled by code) · *Output* → **Output** · *Evals* → **Check** · new, forced by the evidence: **Goal** and **Constraints**.

| # | Part | What it holds | Who fills it | Status |
|---|---|---|---|---|
| 1 | **Goal** | Exactly one objective per node · `trace_up`: the Beam spans and parent it derives from · `priority` must/should/could · `refinement` AND/OR for its children · `status` bound / split / unresolved · depth. No "when-to-use" here (that is routing text for heterogeneous agents; Raman's prisms are never routed — it moves to Capability items). Root also holds `out_of_scope`. | LLM | ⚠️ C1: separate Goal survives, but the rationale changed: not "folding breaks recursion" (Claude Code, ROMA, smolagents all recurse on one string per node) but "coverage, dedup, gap re-dispatch and upward attribution need an enumerable one-objective-per-node". The design lens refuted *Goal as the only thing that flows down* — see Constraints and decision Inputs. |
| 2 | **Inputs** | What this node needs before it can be done, each typed: `decision` (resolved **at Raman time**, in Raman's UI, ≤3 questions per run, each with a recommended default; every default taken goes to the **Assumptions ledger**) · `credential` (never a question — becomes an env-var contract in Capabilities.auth) · `data` (schema, sample, location, size, sensitivity) · `runtime-discoverable` (executor probes it, with a verify command). Each row tagged `provided_by` user / executor / raman. | LLM, then user for decisions | ⚠️ C2: "every unresolved input becomes a question the executor asks" was refuted by walkthrough (dashboard-tool choice changes the whole subtree; API keys would land in the chat transcript). Replaced by the four-way split above, Spec-Kit-style cap on questions, and an Assumptions ledger. |
| 3 | **Instructions** | `method` (how this node's work is done) · `executor_model` + `effort` (a recommendation *for the executor*, in the executor's vocabulary; not Raman's own model) · `persona` **only at the root and at leaves tagged `spawn_subagent`**; a schema validator rejects persona anywhere else. | LLM | ⚠️ Ray 1 wanted optional persona everywhere; Ray 2 wanted none below the root; conflict resolved as above. Persona evidence is weak (Zheng et al. 2024) — ⏳ C7 not yet independently verified. Model placement ✅ C4 (evidence lens, 0.85): every spec puts model beside the prompt, apart from tools. |
| 4 | **Capabilities** | Per item: `catalog_id` · kind (mcp_server, skill, plugin, api, model-as-tool, framework, dataset, saas, prompt_template, workflow) · purpose · **`invoke_when` / `invoke_how`** · `install` keyed by executor client · `auth` contract (env_var name, obtain_url, min_scopes — never values) · `verify` (smoke test) · `cost` (range + plan tier assumed) · `provenance` (publisher, version pin, scan result + date, permissions requested, data_sent_to) · licence / ToS notes · `catalog_version` / `verified_on` · `fallback` · `source_method` (which discovery method found it). | **Binder (code)**. The LLM writes needs without tool names; any name not found in the catalog or confirmed by live search is rejected. | ⚠️ M3: the idea survives; its original justification (TheMCPCompany "seriously struggle") was a misquote — that paper actually shows retrieval-binding works for frontier models (GPT-5 within 2.1 pts of oracle tools) but not for small models, which matters because users pick their own model. `invoke_when` added because installed-but-never-invoked is the documented failure (Vercel evals: 56% never invoked; 53% → 79% with explicit "use this" instructions). |
| 5 | **Constraints** | Inherited downward. Set-like items (scope, permissions, approval gates, executor **environment profile**: client, OS, runtimes, network, MCP support) inherit by **intersection** — a child may only tighten. **Budget inherits by partition** — children's allocations must sum to ≤ the parent's; the parent's Check verifies the sum at merge. A child that cannot satisfy a constraint never loosens it: it emits a typed conflict upward; only the root may loosen, with the user's approval. Each constraint carries an `enforcement` class: advisory · pre-tool deny / hook · permission rule · CI test. | Root from Beam + environment; inherited by code | ❌→⚠️ C3: plain "tighten-only" was refuted by walkthrough: with a $50 cap, four siblings each inheriting "≤$50" produced a $61 plan that every node's check passed. Partition + sum-at-merge fixes it. Attenuation for permissions is well-sourced (Macaroons, AWS permission boundaries, Claude Code subagent tool narrowing). |
| 6 | **Output** | Deliverable · schema / `contract_id` (shared with the consuming node's Inputs, so producer and consumer reference the same object) · destination · one worked example · `side_effect` class (read-only / reversible / irreversible / spends money / contacts third parties) · rollback. | LLM | ⏳ structure not yet skeptic-tested; the contract and side-effect fields come from both critics. |
| 7 | **Check** | One pass/fail criterion the executor can run (shell command · schema validation · one rubric line for an LLM judge) · `on_fail`: retry N / fallback / ask / abort · `enforcement` class · at nodes with children: a **set-level check** (all AND-children satisfied, budget sum, contracts match). | LLM, validated by code | ⏳ C8 (Check needs a stop rule + on-fail) not yet independently verified, but the stop rule itself was (M5, §5). PaperBench's "<15-minute expert check" is real (§3.1 of the paper) but a human-expert criterion whose rubrics took weeks — not a budget Raman can adopt — hence "runnable by the executor". |

Two things are **not** parts, by design: *order* (derived from Inputs → Output contracts at merge, published as the Runbook) and *auth* (a field on every Capability item).

---

## 3. Per-prism loop (bind before split, amended)

1. **Write the need.** The LLM fills Goal, Inputs, Output, Check for this node. It **may propose tool names** (propose-and-verify), but no name is load-bearing until the Binder verifies it. Systems the user named (Apollo, Google Sheets) pre-bind as Inputs/Constraints.
2. **Try to bind.** The Binder exact-matches any proposed name against the catalog first, then runs the discovery ensemble (§7) and shows the top-k candidates, with their schemas, to the prism LLM. A bind is accepted only if **all** hold: the LLM judges that **one** item's description covers the **whole** need (a recorded coverage judgment — never a similarity threshold alone); the item's scope tag matches; it is compatible with the inherited Constraints (executor client, plan tier, cadence, network) and with the node's **runtime** (rule 4); the node is Checkable with one criterion. The catalog includes `platform_feature` / `procedure` rows carrying a vendor-doc URL (Apps Script time trigger, Looker Studio, Sheets publish-to-web, GitHub Actions schedule, OS cron) so solutions that live in no registry can still bind. When binding fails, the retrieved candidates and their required arguments inform the split — hidden dependencies surface here. When nothing grounds, emit an explicit **"build it"** leaf (script + install + check) or a leaf flagged `UNVERIFIED — confirm or install at runtime`; never drop the need silently.
3. **Obstacle pass** (bounded checklist, once per leaf): auth / plan gating · quota · missing fields or credits · schedule jitter or drop · permission / sharing · staleness · schema drift · human-only step (no API). Each obstacle resolves to exactly one of: a new sibling leaf (binder-verified), an `on_fail` line in Check, a **"Decision required"** item surfaced to the user, or nothing with a stated reason.
4. **Leaf or split.** A node is a **leaf** when four gates hold: **Bound** (≥1 catalog-verified item with one designated primary and optional fallback, or one fully written artifact — prompt text, schema, format — or an explicit runtime tool-search instruction for the executor) · **Checkable** (one pass/fail criterion the executor can run) · **Traced** (its chain reaches a Beam criterion, a user decision input, or an `inferred:<rule>`) · **Runnable** (the bound item's kind can execute in the node's inherited `runtime` ∈ {executor_session, scheduled_host:<name>, human}; MCP servers, skills and plugins run only in the executor session unless the scheduled host is an explicit, costed headless run with API-key auth — OAuth MCP logins cannot complete headlessly). Otherwise split, tagging children AND or OR (OR-children become ranked alternatives: first is bound, the rest fill `fallback` — the Solutions-Architect rule of a top pick plus alternatives).
5. **At the depth cap** (configurable, default 6, range 2–8, plus a node / LLM-call budget): first try to resolve in place — write the artifact, or bind the best-confidence candidate flagged `LOW-CONFIDENCE`; only if that fails mark **`UNRESOLVED`** with an owner (custom build / user / assumption). Also force-stop when a split makes no progress (children bind to the parent's own items).
6. **Report up.** The parent runs its set-level Check and merges (§4).

Status: ⚠️ M2 bind-before-split survives 2/3. The design lens refuted *binding on similarity alone* with a concrete trace ("every 30 minutes" bound to Vercel Cron; the executor then hit "Hobby accounts are limited to daily cron jobs" with no fallback), and the counterexample lens dropped ADaPT as the justification: its decompose trigger is executor-reported failure from environment feedback, which a non-executing lookup cannot supply, so ADaPT is cited only for bounded depth. ❌ M3 as first stated ("needs written without tool names; reject any name not in a registry") was refuted by all three lenses: registry-only rejection discards correct answers that live in no registry, independent registry recall at thousands of tools is ~50–65%, and the TheMCPCompany quote was out of context — retrieval binding works for frontier models (GPT-5 within ~2 points of oracle tools) but weaker models lose ~8 points, which is exactly why binding is catalog-side when users bring their own model; Gorilla (hallucinated API names cut from 37–79% to 1–32% with a retriever) and RAG-MCP supply the real evidence for exact-match verification. Replaced by rules 1–2. ❌ M5 as first stated was refuted 2/3 → replaced by rules 4–5 (details in §5). ⚠️ M1: KAOS confirmed as the structural analogy, but its stop rule ("assignable to a single agent") would halt at the root because there is exactly one executor → **operationalized** (rule 4). ⏳ M7–M9 queued (low stakes).

---

## 4. Root-only jobs (the big prism)

- **Intake:** cut the Beam into verbatim spans; read the environment profile (target executor is a one-click input in v1); ask ≤3 decision questions with defaults; open the Assumptions ledger.
- **Split** with AND/OR tags; dispatch children.
- **Merge (code, never the LLM):** union Capabilities by `catalog_id` + scope hash; Constraints tightest-wins; contract matching between producer Output and consumer Inputs; **runtime coherence** — every leaf downstream of a trigger leaf shares the trigger's runtime, and a mismatch is a typed conflict that blocks DONE and re-dispatches the subtree; unresolved conflicts become open questions.
- **Gates (§6)** → **Critic** proposes gaps → re-dispatch only the affected nodes.
- **Saturation stop:** two consecutive critic passes that add **0 binder-accepted leaves** (≤1 when the tree has ≥20 leaves), cap 3 rounds — *adapted* from Guest et al. 2020, whose base-4 / run-2 / ≤5% rule was validated on interview data. Leaves born from critic proposals count only after adjudication (§6). Print an indicative Chapman estimate of remaining gaps, N̂ ≈ (n₁+1)(n₂+1)/(m+1) − 1 (El Emam & Laitenberger 2001; Briand et al. 2000 found capture–recapture unreliable below four inspectors), so "nothing missed" is a measured, hedged claim, with the token cost of another round shown.
- **Emit** `task.md` (§9), the Assumptions ledger, the coverage appendix, and the report-back spec.
- **Store** the run in the Spectral Library (§8).

Root persona: **Solutions Architect** — identifies the situation, not just the problem; hands back an implementable solution with a top pick and alternatives per part.

### 4.1 Budget and cost controls (approved 2026-11-08)

- **Run depth preset**, picked by the user before the run: **quick** (depth cap 3, 1 critic round), **standard** (cap 6, up to 3 rounds), **deep** (cap 8, up to 3 rounds + a larger budget). Each preset carries a token budget; numbers are set from eval-set measurements, not guessed.
- **Cost estimate before the run:** shown from the preset, the request length and the Spectral Library's history for similar requests; the user confirms.
- **Budget partition:** the root's token budget is split among children; a node that exhausts its share resolves in place or goes UNRESOLVED; nothing silently overspends.
- **Sibling batching:** all children of a node are filled in one structured call.
- **Prompt caching:** the shared system prompt, the 7-part schema and the category taxonomy form a cached prefix (reads 0.1x; 0.05x on Opus 5.5 / Sonnet 5.5).
- **History seeding:** similar past runs seed the tree structure; every leaf is still re-bound against today's catalog.
- **Zero-token work stays in code:** retrieval, filtering, merge, constraint inheritance, gates.

---

## 5. Stop rules (summary)

| Level | Rule |
|---|---|
| Node | Leaf = Bound ∧ Checkable ∧ Traced ∧ Runnable. Split only if Bound, Checkable or Runnable fails and depth < cap (default 6, range 2–8). |
| Node | At the cap: resolve in place (write the artifact, or LOW-CONFIDENCE bind) → else UNRESOLVED(owner). Also: no-progress split · nothing grounds → "build it" leaf or UNVERIFIED flag. |
| Tree | Done when the three Gates pass ∧ runtime coherence holds ∧ every UNRESOLVED has an owner ∧ saturation (0 new binder-accepted leaves over 2 critic passes; ≤1 if ≥20 leaves) · cap 3 rounds. |
| Run | Budget partitioned from the root; every parent verifies Σ(children) ≤ cap at merge. |

Status: ❌→⚠️ M5 as first stated was refuted 2/3. The design lens built a tree that passed every gate while no listed capability could run on the scheduled host (stdio MCP servers die with the session; `claude -p` cannot complete OAuth) — hence **Runnable** and runtime coherence. The evidence lens found the citations misattributed: "WBS 2–4 levels" traced to an unsourced Wikipedia sentence (MIL-STD-881 defaults to three levels; PMI says project-specific), and N̂ = n₁n₂/m is Lincoln–Petersen, which Briand et al. restate only as background before recommending the Mh Jackknife estimator. The counterexample lens measured PaperBench's own rubrics (max depth 9; 61% of leaves deeper than 4) and production caps (ROMA default 5, Claude Code 3 layers), hence the configurable cap with resolve-in-place. ⏳ C8 still queued.

---

## 6. Gates (code) and Critic (LLM)

What code can verify is **bookkeeping**: every criterion has ≥1 edge, every category has a leaf or an N/A, every chain terminates properly. The cut of the request into criteria, the criterion→leaf mapping and every "N/A: reason" remain LLM judgments (~10% per-item error in InFoBench's GPT-4 result). The gates therefore **audit and constrain** the LLM's coverage judgment; they do not replace it. The header metric is called *explicit-criterion trace* and is never rendered as "nothing missed"; inferred and compositional coverage are reported separately.

- **Forward trace:** the Beam is cut into requirement-level YES/NO criteria (InFoBench DRFR style) with a pinned prompt at temperature 0, and the union of two independent cuts is used; every criterion maps to ≥1 leaf or is explicitly out-of-scope at the root; every mapping cites a verbatim span; low-confidence mappings are treated as gaps (a spurious re-dispatch is cheap, a missed item is not). "Must" criteria are checked first.
- **Category gate:** every category has a leaf or an explicit "N/A: reason" that cites a span: model + instructions · data / action / orchestration tools · guardrails and human-intervention triggers (failure thresholds, high-risk actions) · inputs and credentials · output format and destination · acceptance checks · environment and runtime · packaging per executor · telemetry / report-back · security vetting and secrets · licensing / ToS · freshness. N/A is **not allowed** on credentials, guardrails or acceptance checks without the user's confirmation in the UI. The ISO 25010 quality characteristics apply when the deliverable is software; documents, research, strategies and analyses get a content checklist instead.
- **Backward trace (transitive):** a leaf is justified only if its chain reaches a Beam criterion, a user decision input, or an explicit `inferred:<rule|profile_item|critic>`; "parent" is never a terminal source. A chain that ends at a category is auto-tagged inferred and listed in the Assumptions ledger so the user can strike it.
- **Critic (mandatory, not optional):** targets the tacit, compositional requirements no span states — idempotency of recurring writes, credit and quota consumption, plan gating, human-only steps such as browser-only setup, third-party data sensitivity. It emits **structured proposals** {verbatim user span or catalog field, missing artifact type (tool / prompt / format / check), target node} and never writes leaves. In LLM-Modulo terms it is the *soft* critic; the gates and the Binder are the *hard* critics that must sign off.
- **Adjudication of critic proposals:** a proposal is re-dispatched only if it is machine-checkable — (i) it names an untraced criterion or an empty category, (ii) it cites a catalog-field contradiction the Binder stores (plan tier, cadence, auth, quota: the "Vercel Cron is daily on Hobby" class), or (iii) it carries a URL + quote that a fetch-and-match step confirms. Anything else goes to the Assumptions ledger as an *unverified critic suggestion* for the user to accept or strike. Leaves created from proposals are tagged `inferred:critic`, carry a cost line, and are excluded from saturation and capture–recapture counts until adjudicated — otherwise non-overlapping hallucinations inflate the estimate.
- **Critic model:** a different model under the **same** key, reasoning tier at least as capable as the prism model, in a fresh context — never a cheaper sibling (a weaker critic is worse than a stronger same-model one); an optional second key allows a cross-provider critic; if the provider exposes one model: same model, fresh context, clause by clause, with the independence downgrade recorded. The rationale is bias reduction (LLM evaluators favour their own generations — Panickssery et al. 2024), not a reliability guarantee: no cited paper shows a prompted second model acting as reliable external feedback.
- **Advisory holistic check:** one rubric-based LLM read of the final task.md, non-blocking (Anthropic found a single rubric call its most consistent judge).

Evidence on critic reliability, stated precisely: in Shefa et al. 2026 (preprint; 13 NASA requirement statements × 7 INCOSE criteria, zero-shot) the highest-recall model, GPT-5, caught a median 47% of expert-flagged defects with 24% false alarms; the best-balanced, Claude Opus 4.7, 33% with 11%; recall rose to 61% on an easier set; the authors call these lower bounds and warn that chaining such modules "risks compounding these deficiencies". Hence saturation plus adjudication, not a single pass.

Status: ⚠️ M4 survives 2/3 — the design lens built a tree that passed all three gates while the product would still fail on tacit facts (Apollo search returns no emails; an append-only Sheet needs idempotent upsert; Looker Studio report creation is browser-only), which produced the transitive trace, the mandatory critic and the renamed metric; Spec Kit's `/speckit.analyze` already does this structure as one LLM pass with a human reading the report. ⚠️ M6 survives 2/3 — the design lens showed a hallucinated critic proposal (a non-existent Apollo webhook) passing every gate, which produced the adjudication rule; "use a cheaper different model" was in none of the cited sources and is dropped. ✅ Code gates over an LLM-only coverage check: Huang 2023, Kamoi 2024, and this project's own self-run (`FRAMEWORK-BREAKS.md`).

---

## 7. Discovery ensemble (the Binder uses every method you catalogued)

Each method produces a ranked list; lists are fused with Reciprocal Rank Fusion; then re-ranked by quality; the method that found the winner is recorded per leaf (`source_method`).

| # | Method (from your 1,000-tool review) | Implementation |
|---|---|---|
| 1 | Keyword + category directories | Postgres full-text search + category filter |
| 2 | Semantic match (anyai.fyi style) | pgvector, gte-small 384-d, inner product |
| 3 | Query rewriting (ToolReAGt) | LLM expands the need into 2–3 phrasings → methods 1–2 |
| 4 | Imagine the ideal tool (ToolDreamer) | LLM writes the ideal item's description → embed → match |
| 5 | Usage ranks (skills.sh, find-skills, Hugging Face, SourceForge, StackShare, Toolify) | installs, downloads, adoption in real stacks; per-source normalized score (traffic data is not freely available → skipped) |
| 6 | Quality / security ranks (Glama-style scores, audits) | skills.sh audits, ClawHub verdicts, deps.dev Scorecard + OSV, last commit, licence |
| 7 | Co-usage (COLT, StackShare) | items bound together in past runs |
| 8 | Historical runs | nearest past runs' bound items (§8) |
| 9 | Live web-search fallback (Poe-style) | provider's web-search tool → provisional catalog rows with source URL and trust score |

| 10 | Curation signal (awesome lists, OpenTools, GitHub MCP Registry, Futurepedia, Best AI Tools, official marketplaces) | number of independent curated lists / official marketplaces the item appears in, plus an official-publisher boost |
| 11 | Community votes (Product Hunt, Uneed, DevHunt, Slant, RankYourAI, AlternativeTo, There's An AI For That) | votes from sources with legal access: GitHub stars, Hugging Face likes, ClawHub stars, skills.sh trending, Product Hunt upvotes (its API's default terms allow non-commercial use) |

**Most-used methods in your 1,000-tool review** (tools per method family, by my grouping of the rows): keyword + category directory search ≈72 · LLM / semantic intent matching ≈16 · curated / editorial lists ≈13 · community votes ≈10 · usage ranks ≈10 · reviews and ratings ≈8 · decompose-then-pick ≈6 · co-usage / tool graph ≈4 · quality scoring ≈2. The top five are all in the ensemble (1, 2–4, 10, 11, 5). Because category search is the most-used method, crawled items are mapped onto **one shared category taxonomy** so the category filter works across sources. **Excluded on purpose:** paid placement (AiTopTools; paid spots on Capterra) is an anti-signal; reviews from G2 / Capterra / TrustRadius have no open API.

Fusion: retrieval methods (1–4, 8) are fused with RRF (k = 50, as in Supabase's hybrid search); ranking signals (5, 6, 7, 10, 11) only re-rank what retrieval found, never retrieve on their own; output top pick + alternatives. Weights are tuned on the eval set. Written artifacts (prompts, schemas, formats) are a separate kind, Bound by being fully written and validated, not by lookup.

---

## 8. Spectral Library (historical runs)

Stored per run: request embedding (request text only with opt-in) · environment profile · model used · the tree (nodes with the 7 parts) · bindings (`catalog_id` + `catalog_version`) · gates report · Assumptions ledger · tokens and cost · **per-prism self-eval** (confidence + reason, paid with the user's tokens) · user rating · optional executor report-back (`raman_report.json`). Never the API key.

Reuse: embed the new request → nearest runs → seed the tree structure → **re-bind every leaf against the current catalog** (never reuse a stale bind) → show "what changed vs. the previous run". Ratings and report-backs re-rank items (method 7–8).

---

## 9. `task.md` layout and packaging

Target: one file. Size rule: the index stays short (Claude Code guidance ≈200 lines for always-loaded context; Codex caps project docs at 32 KiB), detail lives in fenced artifact blocks the executor writes to disk on first run (**bootstrap** step). For ChatGPT, which installs nothing, the same sections render inline with a "set up by hand" list.

0. Header — target executor, catalog date, coverage score
1. Confirm before starting — `ask_at_start` inputs
2. Assumptions ledger — every default taken, with impact if wrong
3. System prompt — root Instructions (persona, method, model + effort)
4. Environment — one-time setup (runtimes, package managers, working dir, secrets location)
5. **Capabilities BoM** — one row per item: ID · need · item · kind · install[client] · auth env var · invoke_when / how · verify · cost · provenance · fallback · parents · spans
6. **Runbook** — ordered DAG: step id · uses · inputs_from · produces · gate · on_error · side_effect
7. Checks — per leaf + a final machine-checkable acceptance list
8. Constraints and gates — deny rules, approval gates, hook / settings snippets where enforcement ≠ advisory
9. Open questions / unresolved — each with an owner
10. Report-back — `raman_report.json` schema (per leaf: done / skipped / failed, check result, tool actually used, cost)
11. Coverage appendix — span → leaf table · category table · orphans · explicit vs inferred counts · capture–recapture estimate
12. Attribution — sources; registry licences where required

Status: ⚠️ D1 ("one prose task.md is not enough; emit real artifacts too") — 1 of 3 lenses refuted, and all three converged on the same amended form, which is what this section now describes: **one `task.md`**; artifacts embedded as fenced blocks tagged with their target paths (`.claude/agents/<name>.md`, `.claude/skills/<name>/SKILL.md`, `.mcp.json` with `${VAR}` placeholders, `.claude/settings.json` with `permissions.allow/deny` + PreToolUse hooks, `raman_report.schema.json`); a **Bootstrap** step, first in the Runbook, has the executor write them to disk; the file stays self-sufficient so an agent can regenerate every artifact. Corrections the skeptics forced:
1. The premise was wrong: markdown **is** configuration when it carries YAML frontmatter in a known location — SKILL.md `allowed-tools` pre-approves tools; `.claude/agents/*.md` sets `permissionMode` and inline `mcpServers`. A prose task.md is "context, not enforced configuration" ✅.
2. Approval prompts are not safety gates: `claude -p` and SDK runs load project `.mcp.json` servers without asking ✅; `permissions.allow` and `enableAllProjectMcpServers` remove prompts; new sessions default to auto mode (permission-modes docs, per the verifier). Only hooks and `permissions.deny` are deterministic, so Checks with enforcement ≠ advisory ship as hook / deny snippets.
3. No plugin directory: packaged agents lose `permissionMode`, hooks and `mcpServers`, and plugin MCP servers still need per-server approval when shipped in a repo.
4. SKILL.md only for reusable procedures, with `disable-model-invocation` and an explicit `/name` call in the Runbook; skills the model must choose to invoke went unused in 56% of Vercel's eval cases. One-off steps stay inline.
5. Packaging per executor: **Codex** = `AGENTS.md` ≤32 KiB + `.codex/config.toml [mcp_servers]` + `.agents/skills/`, run with `codex exec`; **ChatGPT** = inline instructions + a "set up by hand" list (custom MCP connectors via the Plugins UI; write actions are confirmed by the user); **Claude Code** as above, with pinned CLI lines kept as text (`claude mcp add --transport http … --scope project`, `claude plugin install <name>@<marketplace>`).
6. Placeholder env-var names must avoid names Claude Code treats specially (`ANTHROPIC_*`, `AWS_BEARER_TOKEN_BEDROCK`, `HTTPS_PROXY`, `NPM_TOKEN`).

---

## 10. Coverage score (honest version)

Not a success probability. Reported as **explicit-criterion trace** (must-criteria traced / total) · leaves bound-strong vs provisional vs LOW-CONFIDENCE vs UNRESOLVED · categories covered / N·A · inferred leaves (rule / profile / critic; adjudicated or pending) · an indicative residual-gap estimate (Chapman). Example: "12 needs: 10 strong, 2 weak" means 10 leaves bound to maintained, well-rated items and 2 bound only to a generic fallback (plain web search) or an unproven item.

---

## 11. Verification ledger

| Claim | Result | What changed |
|---|---|---|
| C1 Goal separate | ⚠️ 1/3 refuted | rationale rewritten; when-to-use removed; decisions + environment also flow down |
| C2 Inputs separate, unresolved → executor asks | ⚠️ 1/3 refuted | four-way input typing; questions at Raman time, capped; Assumptions ledger |
| C3 Constraints tighten-only | ⚠️ 1/3 refuted | sets intersect, budget partitions, conflicts escalate |
| C4 Model in Instructions | ✅ (1 lens, 0.85) | precise placement + models-as-tools rule |
| C5 Auth as per-item field | ⏳ | — |
| C6 Order derived from contracts | ⏳ | — |
| C7 Persona optional / rename to Instructions | ⏳ | — |
| C8 Check needs stop rule + on-fail | ⏳ | — |
| C9 Context out of v1 | ⏳ | — |
| M1 KAOS as closest match | ⚠️ 1/3 refuted | stop rule = operationalized; obstacle pass bounded; business decisions → user |
| M2 Bind before split | ⚠️ 1/3 refuted | bind = recorded LLM coverage judgment over verified candidates + scope + constraints + runtime + checkable; ADaPT cited only for bounded depth |
| M3 Needs without tool names; reject unverified names | ❌ 3/3 refuted | propose-and-verify; exact match, then semantic candidates; `platform_feature` / `procedure` catalog kinds; "build it" leaf or UNVERIFIED flag instead of rejection; justification re-sourced (Gorilla, RAG-MCP) |
| M4 Three code gates replace the LLM coverage check | ⚠️ 1/3 refuted | gates audit, not replace; criteria not phrases; transitive backward trace; mandatory critic for tacit requirements; content checklist for non-software deliverables |
| M5 Stop rule (Bound ∧ Checkable ∧ Traced; depth 4; ≤5% saturation; n₁n₂/m) | ❌ 2/3 refuted | + Runnable gate and runtime coherence; configurable cap (default 6) with resolve-in-place; saturation counted in leaves; Chapman estimate, indicative only; citations corrected |
| M6 Critic proposes, gates decide; different model | ⚠️ 1/3 refuted | adjudication rule; structured proposals; critic tier ≥ prism model, never cheaper; Shefa numbers stated precisely |
| M7 BoM form · M8 No persona below root · M9 Requirements vs Assumptions | ⏳ | adopted provisionally via the conflict resolutions |
| D1 task.md alone insufficient | ⚠️ 1/3 refuted | premise corrected (frontmatter markdown *is* config; prompts are not gates); all lenses converged on one task.md with embedded bootstrap blocks; no plugin dir; per-executor packaging |
| Ray 4 stack facts | ✅ 60+ facts live-checked | see `RAMAN-TASK.md` for the corrections that changed the stack |
| Ray 3 Claude facts | ✅ 50+ facts live-checked | two refutations: Max is not Claude-Code-only (includes chat surfaces and $100/mo API credits); CI can use `claude setup-token` OAuth, only `--bare` needs an API key |
| Completeness critics | 34 missing items | folded into fields above and into the category gate |

Raw material: `docs/research/`.

---

## 12. Open decisions (yours)

1. ✅ Approved 2026-11-08: the unit in §2 (same 7 parts at every prism; each sub-prism takes one need and fills all 7 parts; persona only at root + spawn_subagent leaves; Capabilities filled by code).
2. Target executor as a one-click v1 input (Claude Code / Codex / ChatGPT / Cursor) — install steps differ per client; the wrong client's step is dead text.
3. Deliverable form: single `task.md` with embedded bootstrap blocks (recommended — all three D1 lenses converged on it) vs `task.md` + zip bundle.
4. Glama as a catalog source: skip in v1 (its licence requires visible attribution on every surface, including `task.md`) — recommended — or include with attribution.
5. Verification backlog: run the high-stakes remainder now (M4, M5, M6, D1 ≈ 12 agents) and the rest later — recommended — or everything now (41 agents; may hit the session limit again).
6. Repo licence: still unresolved from the Nov 7 call. Not treated as settled.
