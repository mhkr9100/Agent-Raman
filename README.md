# Agent Raman

Describe a task. Raman scatters it — like light through a prism — into every need hidden inside it, matches each need to real AI capabilities (MCP servers, skills, plugins, APIs, models), and hands back one `task.md` that Claude Code, Codex or ChatGPT can execute with nothing missed.

Raman never does the task itself. It makes sure the agent that does has the right tools, prompt, inputs, constraints and checks.

**Status:** under construction. Catalog crawler and database are live; the prism engine and UI are next.

- How it works: [`docs/FRAMEWORK.md`](docs/FRAMEWORK.md)
- Build plan: [`docs/RAMAN-TASK.md`](docs/RAMAN-TASK.md)
- What broke when the framework was run on itself: [`docs/FRAMEWORK-BREAKS.md`](docs/FRAMEWORK-BREAKS.md)

Bring your own LLM API key; Raman never stores it.

## Develop

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
npm run crawl -- <source|all> [--dry-run] [--limit N]
```

No licence has been chosen yet; until one is, all rights are reserved.
