# Plugin evals (RAMAN-TASK R11)

Three cases for `claude plugin eval`: they check that the agent-raman skill fires and that an agent following it
produces a plan, not an execution. Format: https://code.claude.com/docs/en/plugin-evals.md (read 2026-11-10).

Not run yet. Two things are needed first:
- Claude Code 2.1.269 or later (`claude --version`).
- A reachable Raman host, so the skill can look things up: `npm run build:skill -- https://<host>` writes the
  host into the plugin.

Then, from the repo root (cases are the folders in `evals/` that hold a `prompt.md`):

    claude plugin eval . --ablation with-without --allow-real-servers --max-cost-usd 5

Gate (R11): the skill shows a positive delta against the run without it. Results land in `evals/results/`
(git-ignored).
