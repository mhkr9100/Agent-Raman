# Ray 1 — Core components validation (2026-11-07)

## Verdict: the 4-part unit is incomplete
Role, Capabilities and Output are well supported, and Check is worth keeping. But the unit lacks three things that real specs and recent research treat as first-class: Goal, Inputs and Constraints. Recommend a 7-part unit.

## A) Field map (bold = unmapped fields that keep recurring)

| Framework | Role | Capabilities | Output | Check | UNMAPPED |
|---|---|---|---|---|---|
| OpenAI Agents SDK `Agent` | instructions, prompt | tools, mcp_servers, model, model_settings | output_type | output_guardrails | **handoffs, handoff_description, input_guardrails**, hooks, tool_use_behavior |
| Claude Code subagent | body (system prompt) | tools, mcpServers, skills, model, effort | – | – | **description (required, routing), disallowedTools, permissionMode, maxTurns**, isolation |
| Claude Agent SDK | system_prompt, agents | tools, mcp_servers, skills, plugins, model | output_format | – | **max_budget_usd, task_budget, max_turns, sandbox, can_use_tool, env** |
| Agent Skills (SKILL.md) | body | allowed-tools, scripts/ | assets/ | – | **description (required: what + when), compatibility** |
| CrewAI Agent + Task | role, backstory | tools, llm | expected_output, output_pydantic/file | guardrail(s), guardrail_max_retries, human_input | **goal, description (both required), context (upstream outputs)**, max_iter |
| Google ADK LlmAgent | instruction | model, tools, code_executor | output_schema, output_key | – | **description, sub_agents, input_schema, callbacks (policy)** |
| A2A 1.0 AgentCard | name, description | skills[] | defaultOutputModes | – | **securityRequirements (card and per skill), defaultInputModes**; input-required and auth-required task states |
| MCP (spec 2026-07-28) | Prompts | Tools | outputSchema | clients validate output | **Resources, Elicitation, inputSchema, annotations (destructiveHint), Authorization**; Sampling and Roots now deprecated |
| AGENTS.md (no schema) | overview | build commands | PR rules | testing instructions | **code style, security considerations** |

- Role, Capabilities and Output appear in every framework.
- Check is the thinnest column → Raman's differentiator; keep it.
- Unmapped fields fall into four groups: constraints/budgets (7 of 9), goal or routing description (5 of 9), inputs (4 of 9), auth (3 of 9).

## B) Missing components
- **Goal: separate, and first.** CrewAI's only required Task fields are description and expected_output. Anthropic's subagent-delegation guidance starts with an objective. LHAW (2026) lists Goal first among underspecification types; tasks missing their goal scored worst on SWE-Bench Pro. The Goal is what a prism splits, so it must be its own field.
- **Inputs: separate.** Mirror of Output (input_schema, CrewAI context, MCP Resources and Elicitation, A2A input-required state). Any input Raman can't resolve becomes a question the agent asks the user before starting (Spec Kit `[NEEDS CLARIFICATION]`). MAST: "fail to ask for clarification" = 6.8% of failures.
- **Constraints: separate.** LHAW: tasks missing constraints had the lowest MCP-Atlas pass@3 (30.6–36.7%). Counter-evidence: ADK puts goal/persona/constraints/output format inside `instruction` — fine for a single agent, not a recursive tree. Constraints pass down to every sub-prism and can only be tightened (like AGENTS.md nearest-file-wins); instructions stay local.
- **Cost: fold into Constraints** (max_budget_usd, maxTurns, max_iter are caps).
- **Handoffs/order: fold into Inputs and Output.** Each prism declares "consumes output of X" (CrewAI context, Oracle Agent Spec data-flow edges, Spec Kit depends-on / `[P]`); order and parallelism derivable.
- **Model: fold into Role as the executor (model + effort), not Capabilities.** Every framework sets model next to instructions; OpenAI's guide makes Model one of three core components. Models used as tools (image gen, embeddings) stay in Capabilities.
- **Auth: fold into Capabilities as a required per-item field** (A2A per-skill securityRequirements, MCP per-server auth). task.md gives env-var names and scopes, never secrets.

Fixes to existing parts:
- **Role:** persona has weak evidence (Zheng et al. 2024, 162 personas, no gain on factual QA) → rename Role to **Instructions**.
- **Check:** needs a stop rule and on-fail path. MAST: "unaware of termination conditions" 12.4%; verification failures 6.2/8.2/9.1%.
- **Context:** leaving it out of v1 is defensible (LHAW: removing context did the least harm, few samples).

## C) Recommended unit (7 parts)
1. **Goal** — objective, why, when to use (split downward)
2. **Inputs** — data sources, upstream outputs, open questions for the user
3. **Instructions** — method, optional persona, executor model and effort
4. **Capabilities** — per item: kind, purpose, install, auth, cost, fallback (merged upward into one install list)
5. **Constraints** — scope, permissions, budget, approval gates (inherited downward, only tightened)
6. **Output** — deliverable, schema, destination (combined upward)
7. **Check** — acceptance criteria, how to verify, stop rule, on-fail (retry N, then escalate)

- Stop splitting when one executor with its listed capabilities can meet the Goal, every Input is resolved or asked, and every Check can actually be run.
- Goal, Instructions, Capabilities, Constraints map directly onto Claude Code subagent frontmatter → Raman could emit ready-to-use subagent files.

## Sources
- https://openai.github.io/openai-agents-python/ref/agent/
- https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/agent-sdk/python
- https://agentskills.io/specification
- https://docs.crewai.com/en/concepts/agents · https://docs.crewai.com/en/concepts/tasks
- https://adk.dev/agents/llm-agents/ · https://adk.dev/callbacks/
- https://a2a-protocol.org/latest/specification/
- https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md · .../deprecated.md
- https://agents.md/
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://arxiv.org/abs/2602.10525 (LHAW, 2026) · https://arxiv.org/abs/2503.13657 (MAST) · https://arxiv.org/abs/2510.04173 (Oracle Open Agent Spec)
- https://github.com/github/spec-kit
- https://aclanthology.org/2024.findings-emnlp.888/ (personas study)
