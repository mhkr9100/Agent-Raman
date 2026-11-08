# Ray 2 — Better/complementary method than prism recursion (2026-11-07)

**Verdict:** Keep the recursion, but change what gets checked and when. Closest rigorous match is KAOS goal-oriented requirements engineering: refine goals "until subgoals are reached that can be assigned to individual agents"; obstacle analysis finds missing failure cases. Pair with a traceability matrix, a fixed checklist of categories, and tool binding against a real registry. "Nothing missed" can only be proven against the user's text, the checklist and the registry; unstated needs stay probabilistic.

## 1) Comparison (fit 1–5)

| Method | Guarantees | Weakness | Fit |
|---|---|---|---|
| Current prism | Ends in concrete leaves | Coverage is one LLM check at the root, explicit text only; always splits; repeats shared leaves | – |
| ADaPT | Splits only on failure; max depth 3 (4 TextCraft) | "Failure" is the model's own report | 4 |
| HTN (SHOP2) | Stops at primitive tasks an operator can execute | Recall depends on method library | 4 |
| KAOS / goal-oriented RE | Complete if every goal provably achieved by spec + domain; stop = assignable to single agent; obstacle trees | Formal proofs costly | 5 |
| MECE / WBS 100% rule | No gaps/overlaps at each split | LLM can claim exhaustiveness but can't verify | 3 |
| Traceability matrix + ISO 25010 checklist | Every phrase traced, every category considered, checkable by code | Only as complete as text + list | 5 |
| Bill of materials | Each leaf a concrete part with ID/source; where-used; stops at bought parts | A format, not discovery | 4 |
| JTBD job map | Covers every stage define→conclude | Many stages don't apply | 3 |
| ToT/GoT, Self-Refine, Reflexion | Explore alternatives, polish | No guarantee without outside feedback | 2 |
| HuggingGPT / TaskWeaver / XAgent | Plan-then-pick-tool | Catalog must fit in context; TaskBench: dependency F1 ~20 below selection F1 | 2 |
| COLT, Re-Invoke, MCP-Zero, Task2MCP | Binding grounded in real index; COLT COMP@K scores full-set recall | Needs registry index | 5 |
| Saturation / capture–recapture | Measurable stop rule | Correlated LLM passes underestimate what's left | 4 |

## 2) Recommendation
Keep single node schema, recursion, gap re-dispatch, depth cap 4. Drop "Role" below the root: persona only at root or on real sub-agents.

1. **Bind before splitting.** Try to bind each need to one registry item; split only if that fails (ADaPT with binding as executor).
2. **Keep decomposition separate from binding.** Write needs without tool names, then look up each in real registries; reject unverifiable names. Top models "seriously struggle" with 18k+ tools (TheMCPCompany).
3. **Three code-verifiable gates** replacing the LLM coverage check:
   - (a) Forward trace: atomic phrases (InFoBench) → ≥1 leaf each.
   - (b) Category gate: every category gets a leaf or "N/A: reason": model+instructions; data/action/orchestration tools; guardrails + human-handoff triggers (OpenAI guide); ISO 25010:2023 nine quality characteristics; inputs & credentials; output format & destination; acceptance checks.
   - (c) Backward trace: every leaf → phrase/category/parent; flag orphans.
   - Gotel & Finkelstein: most traceability problems are pre-requirements tracing, covered by (a)+(c).
4. **100% check at every split**, not just root (PaperBench, WBS).
5. **Obstacle pass per leaf (KAOS):** "what makes this fail?" → checks and fallbacks.
6. **Requirements vs Assumptions (KAOS).** Requirements = what the agent must have; assumptions = what the user supplies (keys, access, data). Take a profile of the user's existing tools as input (LENS 2026 infers unstated requirements from org tool context).
7. **task.md as deduplicated graph in BOM form**; shared leaf once. Row: ID, need, item, scope, check, sources, parents.
8. **Critic proposes, gates decide (LLM-Modulo).** Different model for critic. Self-correction from own feedback doesn't work (Huang 2023, Kamoi 2024). Best LLM reviewers catch median 47% of requirement issues experts find (Shefa 2026).

## 3) Stop rule
LEAF when all hold:
- **Bound:** exactly one registry-verified item (with scope) or fully written artifact (prompt, schema, check). One existing server/skill covering the node → stop even if composite (BOM: don't break down below a purchased item; HTN primitives; KAOS single-agent).
- **Checkable:** one pass/fail criterion (PaperBench: expert can check in <15 min).
- **Traced:** ≥1 source link.

SPLIT only when Bound or Checkable fails and depth < 4 (WBS 2–4 levels; ADaPT 3–4).
FORCE-STOP → mark UNRESOLVED (custom build / ask user / assumption): depth 4; no-progress split; binding finds nothing.
DONE when: three gates pass; every UNRESOLVED has an owner; saturation — two independent gap-finder passes add ≤5% new leaves vs first full pass (Guest 2020). Cap 3 rounds; leftovers → Open Questions. Optional capture–recapture N̂ = n1·n2/m (Briand 2000).

## Sources
ADaPT https://arxiv.org/abs/2311.05772 · SHOP2 https://jair.org/index.php/jair/article/view/10362 · KAOS https://webperso.info.ucl.ac.be/~avl/files/RE01.pdf · WBS https://en.wikipedia.org/wiki/Work_breakdown_structure · MECE https://en.wikipedia.org/wiki/MECE_principle · ISO 25010:2023 https://quality.arc42.org/articles/iso-25010-update-2023 · Gotel & Finkelstein https://discovery.ucl.ac.uk/749/ · BOM https://docs.oracle.com/en/applications/jd-edwards/supply-chain-manufacturing/9.2/eoarp/low-level-code.html · JTBD https://hbr.org/2008/05/the-customer-centered-innovation-map · OpenAI guide https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf · PaperBench https://arxiv.org/abs/2504.01848 · InFoBench https://arxiv.org/abs/2401.03601 · TaskBench https://arxiv.org/abs/2311.18760 · HuggingGPT https://arxiv.org/abs/2303.17580 · TaskWeaver https://arxiv.org/abs/2311.17541 · COLT https://arxiv.org/abs/2405.16089 · Re-Invoke https://arxiv.org/abs/2408.01875 · MCP-Zero https://arxiv.org/abs/2506.01056 · Task2MCP https://arxiv.org/abs/2604.17234 · TheMCPCompany https://arxiv.org/abs/2510.19286 · Huang https://arxiv.org/abs/2310.01798 · Kamoi https://arxiv.org/abs/2406.01297 · LLM-Modulo https://arxiv.org/abs/2402.01817 · Shefa https://arxiv.org/abs/2609.03230 · LENS https://arxiv.org/abs/2606.25867 · Guest https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0232076 · Briand https://www.simula.no/research/comprehensive-evaluation-capture-recapture-models-estimating-software-defect-content
