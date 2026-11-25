# AgentRamaN

Spec tools tell your agent what to build. AgentRamaN tells it what to build **with**.

Describe a task. AgentRamaN splits it into every need hidden inside it, binds each need to a real capability from its
own crawled catalog (MCP servers, skills, plugins, models), and returns one `task.md` for Claude Code, Codex,
ChatGPT or Cursor: tools, inputs, constraints, a pass/fail check per step, and an honest list of what it could
not resolve. AgentRamaN never runs the task.

**Status:** built, not yet deployed; no public host yet. A first with/without test on 10 November 2026
([`evals/ab/RESULTS.md`](evals/ab/RESULTS.md)) found that plans written through the agent path were scored lower than
plans the same models wrote alone, and cost more to write. A second test the same day ([`evals/ab/CHECK-RESULTS.md`](evals/ab/CHECK-RESULTS.md)) used it to check an existing plan instead: it added nothing over one free line in the prompt ("verify every factual claim on the web before you finish"). The MCP server and the skill stay on hold.

## Three ways to use it (the first two are on hold)

| Way | Who thinks | Needs a model key |
|---|---|---|
| **MCP server** `https://<host>/api/mcp` | your agent, following AgentRamaN's method | no |
| **Skill / Claude Code plugin** (`skills/agent-raman`) | your agent, following AgentRamaN's method | no |
| **Web app** | AgentRamaN, with your own key (sent per request, never stored) | yes |

Once a host exists:

```bash
claude mcp add --transport http agent-raman https://<host>/api/mcp
```

```bash
npx skills add mhkr9100/Agent-Raman
```

In Claude Code: `/plugin marketplace add mhkr9100/Agent-Raman`, then `/plugin install agent-raman@agent-raman`.
Then ask: "Use AgentRamaN to plan: <your task>".

## Run it locally

```bash
npm install
cp .env.example .env.local   # Supabase values; see the file
npm run dev
```

Checks: `npm run test:engine`, `npm run test:agent`, `npm run eval:binder`, `npm run eval:tasks`.
Crawler: `npm run crawl -- <source|all> [--dry-run] [--limit N]`.

## Earlier generations

This repository is the single home of the RamN project. Two earlier versions are kept here as branches, each with its full history. They are separate codebases and are not maintained.

| Branch | What it was | Active |
|---|---|---|
| [`gen-1-web-beta`](https://github.com/mhkr9100/Agent-Raman/tree/gen-1-web-beta) | RamN AI (Beta): a web app for arranging several AI agents into workspaces | Feb to Mar 2026 |
| [`gen-2-desktop`](https://github.com/mhkr9100/Agent-Raman/tree/gen-2-desktop) | Raman AI: an Electron desktop workspace with local storage and a local model runtime | Mar to Oct 2026 |

The repositories they came from, `RamN-AI` and `RamNAI`, are archived.

## Read more

- Method: [`docs/FRAMEWORK.md`](docs/FRAMEWORK.md)
- Build plan and status: [`docs/RAMAN-TASK.md`](docs/RAMAN-TASK.md)
- Known gaps: [`docs/BACKLOG.md`](docs/BACKLOG.md)
- What broke when the framework was run on itself: [`docs/FRAMEWORK-BREAKS.md`](docs/FRAMEWORK-BREAKS.md)

No licence has been chosen yet; until one is, all rights are reserved.
