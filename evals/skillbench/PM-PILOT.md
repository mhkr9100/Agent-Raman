# Skill pilot: which PM skill writes the better spec? (design, written before any run, 11 November 2026)

## Question

Many public skills claim to make an AI agent better at the same job. Rankings sort them by installs or stars,
not by results. This pilot measures, for one common job (writing a product spec, a PRD), whether a skill helps
at all and whether competing skills differ.

## Arms

| Arm | Skill | Source | Popularity on 2026-11-11 |
|---|---|---|---|
| N | none | | |
| S1 | `write-spec`, Anthropic's official product-management plugin | Claude plugin, read from the local install | official |
| S2 | `prd` by bjesuiter | ClawHub v2.0.5 | most-installed PRD skill on ClawHub: 242 installs, 10 stars |
| S3 | `product-manager` by ivangdavila | ClawHub v1.0.0 | most-installed general PM skill: 199 installs, 11 stars |

How a skill is given: its SKILL.md text is placed in the prompt with "Follow this skill". S2 also gets its
`references/output-patterns.md` (the templates). S2's `references/agent-usage.md` and `workflows.md` are left
out: they describe running a coding agent on the spec, not writing it, and `agent-usage.md` shows a loop that
runs Claude Code with permissions skipped. This is close to how an agent loads a skill, not identical: a real
agent loads reference files on demand.

Note before the run: S2 is not a product spec skill. It turns a feature into a JSON task list for a coding-agent
loop. It is included because a user searching "PRD" by installs would pick it.

## Tasks

4 PRD requests with all context given in the prompt ([`tasks.json`](tasks.json)), 7 requirements each, written
before any output. Each has a conflict or limit in the context that a good spec must handle (an unscoped EU
consent issue, an iOS permission rule, a role restriction and a 2-million-row report, a 120-day chargeback risk).

## Run

- Writer: Claude Sonnet 5.5, clean room, no tools, no questions (questions go into the spec). One output per
  task and arm: 16 specs.
- Reviewers: 2 per task (8), each sees the four specs as P1 to P4 in a different shuffled order, with skill
  names removed. Rubric: requirements (yes / partly / no), invented facts (numbers or claims not in the context
  stated as fact), useful to an engineer 1 to 5, useful to a stakeholder 1 to 5, concise 1 to 5, overall 1 to 10,
  ranking.
- Cost: tokens per output from the transcripts.

## Rules, fixed now

- A skill **helps** if its mean overall score is at least 1.0 above N and a reviewer prefers it over N in at
  least 6 of 8 task-reviewer pairs.
- The skills **differ** if the best and the worst skill differ by at least 1.5 in mean overall score.
- **Popularity predicts quality** only if the ranking by installs (S2 > S3) matches the ranking by score.

## Limits, before the run

- 4 tasks, one output per cell, 2 reviewers: direction only, not precise sizes.
- One job type (PRD), one writer model. Writer and reviewers are Claude models.
- The official skill and the reviewers come from the same company.
- Specs are read, not used to build anything.
