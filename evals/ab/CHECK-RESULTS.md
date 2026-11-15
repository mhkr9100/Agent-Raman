# Checker test: results (10 November 2026)

Design and stop rule, written before the run: [`CHECK-TEST.md`](CHECK-TEST.md).

## Result in one paragraph

The 12 plans that planners wrote alone in the first test were each given a second pass, twice: once with one
line ("Verify every factual claim in this plan on the web before you finish. Fix what is wrong."), and once
with that line plus an AgentRamaN check. **The one line cut the wrong claims from 22 to 12 and raised the score
from 5.5 to 7.6. Adding the AgentRamaN check changed nothing for the better:** the same 12 wrong claims, a lower
score (7.1), and 1.2 to 2 times the cost of the pass. All three parts of the stop rule failed.

## Stop rule

| Rule | Needed | Got | |
|---|---|---|---|
| 1. Fewer wrong claims than the one line | 30% fewer | 0% fewer (12 against 12) | not met |
| 2. Ranked above the one line | 9 of 12 plans | 4 of 12 | not met |
| 3. Mean overall score not lower | at least 7.58 | 7.08 | not met |

## Claims

One table of 10 risky points of fact per plan (120 rows), checked on the web, marked per version.

| Version | Correct | Wrong | Not settled | Flagged by the plan | Says nothing |
|---|---|---|---|---|---|
| O: original | 33 | 22 | 2 | 22 | 41 |
| V1: one line | 89 | 12 | 2 | 10 | 7 |
| V2: one line + check | 83 | 12 | 1 | 12 | 12 |

The first test's reviewers had found 11 distinct faults in the originals. The new reviewers confirmed 10 of them.

| Version | Still wrong | Corrected | Flagged |
|---|---|---|---|
| O | 10 | 0 | 1 |
| V1 | 3 | 6 | 2 |
| V2 | 3 | 7 | 1 |

## Scores

Mean over the 12 plans. These scores are not comparable with the first test's: the reviewers here compared three
versions of one plan and checked far more facts per plan.

| Version | Overall /10 | Can be executed /5 | Concise /5 | Honest /2 | Requirements met | Ranked first |
|---|---|---|---|---|---|---|
| O | 5.50 | 3.00 | 4.42 | 1.42 | 85% | 0 |
| V1 | **7.58** | 4.00 | 3.83 | 1.75 | 94% | 8 |
| V2 | 7.08 | 3.92 | 3.17 | 1.75 | 92% | 4 |

The direction is the same on both planner models (Sonnet: 5.83, 8.00, 7.33; Haiku: 5.17, 7.17, 6.83).

## Cost of the second pass

Same cost index as the first test. "Writing" is what the original plan cost.

| | Cost index | Output tokens | Tool calls | Seconds |
|---|---|---|---|---|
| Writing, Sonnet | 59,198 | 3,382 | 0 | 26 |
| V1 pass, Sonnet | 106,247 | 5,438 | 10.5 | 45 |
| V2 pass, Sonnet | 131,822 | 7,321 | 11.2 | 58 |
| Writing, Haiku | 71,969 | 5,362 | 0.5 | 28 |
| V1 pass, Haiku | 113,146 | 7,564 | 7.5 | 39 |
| V2 pass, Haiku | 230,082 | 21,338 | 11.2 | 95 |

The web pass costs about 1.6 to 1.8 times what writing the plan cost, on top of it. The AgentRamaN check adds
another 24% (Sonnet) to 103% (Haiku).

## What the check actually did

All 12 V2 agents used the service: 30 calls (17 check, 13 find). 8 of the 17 checks returned problems. Every
problem was about structure: a category with no step, a write with no rollback line, a tool name that is not a
catalog id, a credential without a variable name. **None was about a fact being wrong.** The wrong facts in these
plans were tool facts (a version floor, a menu path, a retired feature), and only the web pass touched those.

The check also added a few errors of its own: statements about what is or is not "in the catalog", and extra
text that lowered the concision score (3.17 against 3.83).

## What this says beyond the product

- Plans written alone looked good when read (first test) and were wrong on about 4 in 10 of the risky facts they
  stated as fact (22 wrong, 33 correct). The planners had made almost no web lookups.
- One free line fixes about half of that.
- 12 of 120 points were still wrong after a web pass. Several are very recent vendor changes, for example HubSpot
  closing the creation of new private apps on 26 October 2026.

## Limits

- 12 plans, one pass per arm, one reviewer per plan. With all three rules missed by a wide margin, no second
  reviewer was added.
- Plans were read and fact-checked, not executed.
- Planners, checkers and reviewers are all Claude models.
- Blinding is weak: a version that mentions a catalog can be recognised.
- Five reviewers reported that their web lookups stopped at 14 to 17 of about 25; some rows were settled with
  `curl` on the same pages, a few were left unsettled.
- The first launch of the review run went out without the requirement lists. It was stopped at once and
  restarted with them; no result of the first launch was used.

## Files

`check-generate.workflow.js` (the two prompts), `check-prep.mjs` (review packets), `check-judge.workflow.js`
(rubric), `check-aggregate.mjs` (tables and stop rule). Raw data: `evals/results/check/` (git-ignored).
