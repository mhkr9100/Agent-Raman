# With/without test: results (10 November 2026)

## Result in one paragraph

Fresh agents with no knowledge of this project wrote a plan for six requests, once alone and once with
AgentRamaN (the agent path over HTTP, version 0.1.0). Two reviewers scored every plan. **The plans written
with AgentRamaN scored lower in 23 of 24 direct comparisons, tied in 1, and won 0.** They also cost 2.4 to
3.3 times more to write and took 3 to 4.5 times longer. The test measured the plan as a document. It did not
run the plans, so it says nothing yet about what happens during execution.

## What was run

| Item | Value |
|---|---|
| Requests | 6, in [`tasks.json`](tasks.json). None is in the 20-task set. One names a made-up product (ZorbTrack 7). |
| Requirements | 6 or 7 per request, written before any plan existed |
| Arm A | The planner gets the request and a fixed instruction, and writes task.md alone |
| Arm B | Same instruction, plus "use Agent Raman": read the guide, call find / get / check / render |
| Planner models | Claude Sonnet 5.5 and Claude Haiku (one run per request, arm and model: 24 plans) |
| Planner context | Clean room: no files, no memory, no project instructions. Web search allowed in both arms. |
| Reviewers | 2 per request (12 in total), each scoring the four plans in a different shuffled order |
| Rubric | Fixed before review: [`judge.workflow.js`](judge.workflow.js) |
| Prompts | [`generate.workflow.js`](generate.workflow.js) |

All 12 arm-B runs reached a rendered file. The server answered 47 calls: 16 find, 2 get, 15 check, 14 render.

## Quality

Each cell is the mean of 12 reviews (6 requests x 2 reviewers).

| Arm | Overall /10 | Can be executed /5 | Concise /5 | Honest /2 | Requirements met | Mean rank (1 = best of 4) | Ranked first |
|---|---|---|---|---|---|---|---|
| A Sonnet (alone) | **7.92** | 4.25 | 4.58 | 2.00 | 100% | 1.17 | 10 |
| B Sonnet (with AgentRamaN) | 5.33 | 3.00 | 2.00 | 1.00 | 95% | 3.33 | 0 |
| A Haiku (alone) | **7.17** | 3.92 | 4.33 | 1.92 | 97% | 1.92 | 2 |
| B Haiku (with AgentRamaN) | 5.00 | 3.08 | 2.00 | 1.25 | 87% | 3.58 | 0 |

Same request, same model, same reviewer, overall score with AgentRamaN minus without:

| Model | Mean difference | Better | Tie | Worse |
|---|---|---|---|---|
| Sonnet | -2.58 | 0 | 0 | 12 |
| Haiku | -2.17 | 0 | 1 | 11 |

Mean overall score per request:

| Request | A Sonnet | B Sonnet | A Haiku | B Haiku |
|---|---|---|---|---|
| t1 HubSpot to Teams, weekdays | 8.0 | 5.0 | 6.0 | 5.5 |
| t2 Vector database pricing report | 8.0 | 5.5 | 7.0 | 5.0 |
| t3 Lighthouse, GitHub issues | 8.0 | 6.0 | 7.5 | 4.0 |
| t4 ZorbTrack 7 to Google Sheet (made-up product) | 7.0 | 5.0 | 8.0 | 4.0 |
| t5 Interviews to a 6-slide deck | 8.0 | 5.0 | 7.0 | 6.0 |
| t6 Daily pricing watch under $5 | 8.5 | 5.5 | 7.5 | 5.5 |

Tools and facts the reviewers checked on the web:

| Arm | Tools named | Do not exist | Do not fit | Risky claims checked | Wrong |
|---|---|---|---|---|---|
| A Sonnet | 80 | 0 | 0 | 48 | 8 |
| B Sonnet | 61 | 0 | 0 | 46 | 14 |
| A Haiku | 73 | 1 | 0 | 48 | 6 |
| B Haiku | 62 | 0 | 1 | 44 | 12 |

Made-up product (t4): both arm-A plans were marked "handled" by both reviewers. Arm B: Sonnet "partly" and
"handled"; Haiku "partly" twice. No plan invented a ZorbTrack endpoint outright.

Reviewer agreement: the two reviewers' scores for the same plan differed by 0.29 points on average
(correlation 0.93), and they agreed on the winner in 11 of 12 with/without comparisons.

## Cost of planning

Tokens are summed over every model call of the planner. The cost index is
`input + 1.25 x cache write + 0.1 x cache read + 5 x output`. The weights are an assumption about usual price
ratios, not a bill. Every planner carried the same harness prefix of about 54,000 tokens, in both arms.

| Arm | Model calls | Cache write | Cache read | Output tokens | Cost index | Tool calls | Seconds | File length (chars) |
|---|---|---|---|---|---|---|---|---|
| A Sonnet | 1 | 32,060 | 22,094 | 3,382 | 59,198 | 0 | 26 | 8,052 |
| B Sonnet | 6 | 54,006 | 341,394 | 8,269 | 143,004 | 5 | 81 | 19,316 |
| A Haiku | 1 | 32,872 | 40,682 | 5,362 | 71,969 | 1 | 28 | 8,513 |
| B Haiku | 7 | 71,557 | 444,894 | 20,484 | 236,368 | 6 | 128 | 23,570 |

- Planning with AgentRamaN cost 2.4 times more on Sonnet and 3.3 times more on Haiku.
- There was **no token saving in the planning phase**. A saving could only appear during execution (fewer
  wrong turns, fewer retries), and that was not measured.
- The largest single input cost is the reply of `find`: about 14,500 characters per call, 16 calls.
- One `find` reply failed inside the embedding function (`WORKER_RESOURCE_LIMIT`) when several planners
  called at once.

## Why the plans with AgentRamaN scored lower

The same reasons appear across requests and reviewers.

1. **Most of the file is template.** Half to two thirds of each file is the same on every request: an empty
   capabilities table, a bootstrap step with nothing to install, the report schema, coverage tables, deny
   rules, attribution. The request-specific content is hard to find. Concision 2.0 against 4.3 to 4.6.
2. **The steps are thin.** One line per step. Endpoints, payloads, regular expressions and cron lines are left
   to the executor. The plans written alone spelled these out.
3. **The file contradicts itself.** Section 9 says "Nothing is open." while section 1 lists decisions nobody
   confirmed. Some files refer to a "Decision 3" that does not exist or repeat the schedule step.
4. **Catalog items added risk without adding value.** Where a built-in command or a common package would do,
   the plan bound a third-party item: a paid analytics MCP server with no fallback, community skills, a Sheets
   skill that needs an account the plan does not mention, an MCP wrapper around Lighthouse.
5. **Facts about the bound items were wrong or missing.** Example: the wrong environment variable name for
   the GitHub plugin's token, and stdio and HTTP sign-in mixed up for a Sheets server.
6. **Unverified facts were not flagged.** Honesty 1.0 to 1.25 against about 2.0. The plans written alone said
   at the top that nothing had been verified. The AgentRamaN file reads as checked when it was not.
7. **More wrong claims.** 14 and 12 against 8 and 6. Examples: a retired Teams webhook connector, the wrong
   HTTP status for a success.

What the reviewers liked in the AgentRamaN plans: a stop for a person before any outside write, duplicate
checks, rollback lines, dry runs, refusing to guess the made-up product's interface, and tight count and
quote checks.

## Limits of this test

- **Document review only.** No plan was executed. A plan that reads worse could still run better, and the
  reverse. This is the largest gap.
- **Not truly blind.** The product name was replaced, but the two kinds of file look different.
- **Same model family.** Planners and reviewers are all Claude models. Reviewers may prefer their own style.
- **Strong planners only.** Sonnet and Haiku write good plans alone. A weaker model may gain more.
- **Agent path only.** The web engine, where AgentRamaN thinks with the user's key, was not tested. No real
  key with credit was available.
- **One run per cell.** 24 plans. The direction is clear (23 of 24); the exact sizes are not.
- **The rubric rewards short files.** Concision is one of the scores, and it pulls the overall score.
- Reviewer web lookups were capped at about 25 each. Two reviewers were re-run after a first pass failed.
- The cost index uses assumed weights.

## What to fix first

These are logged in `docs/BACKLOG.md`. None is applied yet.

1. Render only what the request needs: drop empty sections and fixed boilerplate from the file.
2. Make the step cards carry the method: the endpoint, the payload, the exact command, the schedule line.
3. Fix "Nothing is open." so it counts unconfirmed decisions (`src/lib/prism/render.ts`).
4. Mark every fact as verified or not verified, and say at the top what was not verified.
5. Prefer a built-in command or a standard package when one covers the need. Bind a catalog item only when it
   adds something, and always name a fallback.
6. Store sign-in and requirement facts for the most used catalog items, with a source and a date.
7. Shrink the `find` reply.

## What to test next

1. **Run the plans.** Hand each plan to a fresh agent in a sandbox, score the outcome against the requirement
   list, and count tokens, retries and time. This is the only test that can show a saving.
2. Repeat after the fixes above, with the same six requests and the same rubric.
3. Other tools and model families (ChatGPT, Codex, Gemini, Perplexity): see [`README.md`](README.md).
4. The web engine with a real key.
5. A human reviewer on a sample, blind to the arm.
