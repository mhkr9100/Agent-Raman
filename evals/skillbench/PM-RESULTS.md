# Skill pilot: results (11 November 2026)

Design and rules, written before the run: [`PM-PILOT.md`](PM-PILOT.md).

## Result in one paragraph

Four product specs were written by Claude Sonnet 5.5 with no skill and with each of three competing PM skills
(16 specs), then scored blind by two reviewers each. **No skill passed the bar of "helps"** (+1.0 overall and
preferred over no skill in 6 of 8 reviews). **The three skills did not differ in overall quality** (spread 0.38
against a bar of 1.5). **Install counts did not predict quality.** What did differ was the kind of spec each skill
produces: one is clearly better for engineers, another clearly better for executives. That difference, not the
overall score, is the useful finding.

## Scores

Mean of 8 reviews per arm (4 tasks x 2 reviewers). Cost index as in the earlier tests (tokens, weighted).

| Arm | Skill | Overall /10 | Requirements met | For engineers /5 | For executives /5 | Concise /5 | Invented facts per spec | Preferred over no skill | Cost index |
|---|---|---|---|---|---|---|---|---|---|
| N | none | 6.88 | 81% | 3.88 | 3.75 | 3.88 | 0.50 | | 63,205 |
| S1 | `write-spec` (Anthropic, official) | 6.88 | **88%** | 3.75 | 4.00 | 3.50 | 0.50 | 4 of 8 | 71,508 |
| S2 | `prd` (most installed, 242) | 7.25 | 81% | **4.50** | 3.13 | 3.63 | 0.25 | 6 of 8 | 73,149 |
| S3 | `product-manager` (199 installs) | 7.25 | 86% | 3.88 | **4.38** | 3.88 | 0.00 | 4 of 8 | 68,729 |

Per task, mean overall (N / S1 / S2 / S3):

| Task | N | S1 | S2 | S3 |
|---|---|---|---|---|
| p1 recurring invoices | 6.0 | 7.5 | 8.0 | 7.5 |
| p2 onboarding drop-off | 6.5 | 7.0 | 7.5 | 6.0 |
| p3 CSV export | **8.0** | 7.0 | 5.5 | 7.5 |
| p4 instant payouts | 7.0 | 6.0 | 8.0 | 8.0 |

Which arm the task matters more than which skill: S2 ranges from 5.5 to 8.0 across tasks, and on the CSV export
the spec with no skill was best for both reviewers.

## Rules

| Rule | Bar | Result |
|---|---|---|
| A skill helps | +1.0 over N and preferred in 6 of 8 | S1 +0.00 (4 of 8), S2 +0.38 (6 of 8), S3 +0.38 (4 of 8): none |
| The skills differ | best minus worst at least 1.5 | 0.38: no |
| Popularity predicts quality | S2 (more installs) above S3 | 7.25 and 7.25: no |

## What each skill does to a spec (from the reviewers' notes)

- **S1, official `write-spec`.** Meets the most requirements, but follows its template closely: generic user
  stories, P1/P2 wish lists, leading/lagging metric tables. It tends to leave decisions open instead of
  recommending one. In one task it misstated the funnel drop in its headline number (both reviewers caught it).
- **S2, `prd`.** Written for coding agents, not product managers. Its specs are the easiest to build from
  (dependency-ordered stories, testable criteria, cut lists) and the hardest for an executive to decide from.
  It pastes "Typecheck passes" into every product story.
- **S3, `product-manager`.** A list of PM principles rather than a template. Best for decision makers, but on the
  onboarding task it offered four options and never committed to one, so engineers could not start.
- **N, no skill.** Shortest and plainest. Most often missing owners on open questions and acceptance criteria.

## What this means

- For writing a spec, a strong model with no skill is about as good as with any of these skills. The skill adds
  9 to 16% to the cost and 13 to 20% to the length.
- The skills are not better or worse; they are different in shape. Which one to use depends on who reads the
  spec. A ranking by overall score or by installs hides that.
- The most-installed "PRD" skill is not a product skill at all. A user picking by installs gets a coding-agent
  task list.

## Limits

- 4 tasks, 1 spec per cell, 2 reviewers per task. The reviewers' scores differed by 0.38 points on average (at
  most 1) and they picked the same winner in 2 of 4 tasks: differences under about 0.5 are noise here.
- One job type, one writer model (a strong one). A weaker model may gain more from a skill.
- Writer, reviewers and the official skill are all from the same company.
- Blinding is partial: S2's "Typecheck passes" lines are recognisable.
- Skills were given as text in the prompt, not loaded by an agent on demand.
- Specs were read, not used to build anything.

## Files

`tasks.json` (tasks and requirements), `write.workflow.js` (writers), `prep.mjs` (saves specs, builds blind
packets), `review.workflow.js` (rubric), `score.mjs` (tables and rules). Raw specs and reviews are in the session
scratchpad, not in the repo.
