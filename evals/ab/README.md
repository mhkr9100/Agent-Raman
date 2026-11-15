# With/without test kit

Does a plan get better when the planner uses AgentRamaN? This folder holds everything needed to ask that
question the same way each time, in any tool. Results of the first run: [`RESULTS.md`](RESULTS.md).

## Files

| File | What it is |
|---|---|
| `tasks.json` | The six requests and the requirement list for each. Written before any plan. **Do not edit after seeing results**; add new requests under new ids instead. |
| `generate.workflow.js` | The two prompts (arm A alone, arm B with AgentRamaN) and the Claude Code workflow that runs 24 clean-room planners |
| `collect.mjs` | Reads the planners' transcripts: tokens, tool calls, time, file length. Writes `metrics.json` |
| `judge-prep.mjs` | Builds the reviewer packets: four plans per request as P1 to P4 in a shuffled order, product name replaced |
| `judge.workflow.js` | The rubric and the workflow that runs two reviewers per request |
| `aggregate.mjs` | Turns the reviews into the tables in `RESULTS.md`. Writes `scores.json` |
| `CHECK-TEST.md`, `CHECK-RESULTS.md`, `check-*.mjs`, `check-*.workflow.js` | The second test: does an AgentRamaN check of an existing plan beat one line ("verify every claim on the web")? Design and stop rule written first; result: it does not. |

Outputs go to `evals/results/ab/` and `evals/results/check/`, which are git-ignored.

## Run it in Claude Code

1. Start the local test server (`raman-test` in `.claude/launch.json`, port 3100). It sets `RAMAN_RATE_LIMIT=off`
   and `RAMAN_TEST_LOG`; both are local test switches and must never be set on a public host.
2. Run `generate.workflow.js` with `args: { tasks: <the tasks array> }`.
3. `node evals/ab/collect.mjs <workflow transcript dir>`
4. `node evals/ab/judge-prep.mjs <packet dir>`
5. Run `judge.workflow.js` with `args: { tasks, dir: <packet dir> }`.
6. `node evals/ab/aggregate.mjs <reviewer output .json>`

## Run it by hand in another tool (ChatGPT, Codex, Gemini, Perplexity, Claude)

**What is possible today.** These tools cannot reach `localhost`, and there is no public host yet. So the
catalog calls (find, check, render) cannot be used from them. Until a host exists, the only arm B you can run
there is "method as text": paste the guide into the chat. That tests the method without the catalog, which is
a weaker and different test. Record it as arm **M**, not B.

For each request in `tasks.json`, in a **new chat with memory and custom instructions off**:

- **Arm A.** Paste the `COMMON` prompt from `generate.workflow.js` with the request filled in, then the line
  "Reply with the complete task.md as your final message and nothing else."
- **Arm M.** The same, then: "Follow the method below to make this plan." and the text of
  `http://localhost:3000/api/v1/guide` (open it in a browser while `npm run dev` runs, and copy it).
- **Arm B** (once a public host exists). The `ARM_B` prompt with the host's address instead of `localhost:3100`.

Save every reply as `evals/results/ab/<arm>-<task id>-<tool>.task.md`, for example `A-t1-hubspot-teams-chatgpt.task.md`.

Write down for every run, in a sheet with one row per run:

| Column | How to get it |
|---|---|
| tool, model, date | From the tool. Note the exact model name; "ChatGPT" is not enough. |
| web search on or off | Keep it the same in both arms |
| time to answer | A stopwatch |
| tokens or credits | The API usage page if you use an API key; most chat apps do not show it, so write "not shown" |
| follow-up questions asked | Count them. The prompt says not to ask; a tool that asks anyway is a finding. |
| answer length | Character count of the saved file |

Scoring: use the rubric in `judge.workflow.js` word for word. Either give the saved files to a reviewer model
that did **not** write them, or score a sample yourself. To reuse `judge-prep.mjs` and `aggregate.mjs` for other
tools, change the `PLANS` list in `judge-prep.mjs` to the arms and tools you ran.

## Rules that keep the test honest

These are the steps that are easy to miss.

1. **Write the requirements before any plan exists**, and never change them afterwards.
2. **Change one thing.** Same request, same instruction, same model, same web access. Only "use AgentRamaN" differs.
3. **Clean room.** No project files, no memory, no custom instructions. Otherwise the planner already knows the method.
4. **Compare pairs.** Same request, same model, same reviewer. Averages across different requests hide the answer.
5. **Hide the arm from the reviewer** as far as possible, and shuffle the order. Say plainly where blinding is weak.
6. **Two reviewers per plan**, and report how far they disagree.
7. **Check facts on the web.** A plan that sounds sure can be wrong. Count wrong claims and tools that do not exist.
8. **Include a trap.** One request names a product that does not exist. A good planner says so and asks.
9. **Do not let the reviewer be the planner.** Use a different model family for review when you can.
10. **Count every token**, including what the planner reads back from AgentRamaN, and state the fixed overhead of the tool.
11. **Run more than once** if a decision depends on a small difference. One run per cell shows direction only.
12. **Execute the plans.** Reading a plan is not the same as running it. Hand each plan to a fresh agent in a
    sandbox, score the result against the same requirement list, and count the tokens and retries of the
    execution. This is the only place a saving can show up, and the first run did not do it.
13. **Report the result you got**, including when it goes against the product.
