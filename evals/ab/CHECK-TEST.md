# Checker test: design, written before any run (10 November 2026)

## Question

The first test ([`RESULTS.md`](RESULTS.md)) showed that AgentRamaN makes a plan worse when it writes the plan.
One idea is left: use it to **check** a plan the agent already wrote. This test asks whether that check adds
anything over one free line in the prompt.

## Arms

Start: the 12 plans the planners wrote alone in the first test (`evals/results/ab/A-*.task.md`; 6 requests,
Sonnet and Haiku).

| Arm | What happens |
|---|---|
| O | The original plan, unchanged |
| V1 | A fresh agent (same model as the plan's author) gets the request, the plan and one line: "Verify every factual claim in this plan on the web before you finish. Fix what is wrong." |
| V2 | The same as V1, plus: check the plan with AgentRamaN (`check` for the plan rules, `find` and `get` to confirm each named tool against the catalog). No `render`: the plan keeps its own format. |

Only one thing differs between V1 and V2: the AgentRamaN check. Both have web search. Both run in a clean room
(no files, no memory, no project instructions). Nothing new was built for V2: it uses the endpoints that exist.

## Review

One reviewer per plan (12), blind to the arm, three versions in a shuffled order. The reviewer:

1. builds one table of the riskiest factual claims found in any version (up to 10), always including the faults
   the first test's reviewers found in the original, checks each on the web, and marks it per version:
   correct, wrong, unverified, flagged by the plan as unverified, or absent;
2. scores each version on the first test's rubric (requirements, honesty, can be executed, concise, overall);
3. ranks the three versions.

Cost of each second pass is read from the transcripts with the same cost index as the first test.

## Measures

- **Primary:** number of wrong claims per arm, summed over the 12 plans, on the shared claim tables.
- Secondary: how many of the first test's known faults are still wrong; overall score; rank of V2 against V1;
  cost index and seconds of the pass.

## Stop rule, fixed now

The check "clearly beats the one line" only if **all three** hold:

1. V2 has at least 30% fewer wrong claims than V1, summed over the 12 plans;
2. V2 is ranked above V1 in at least 9 of the 12 plans;
3. V2's mean overall score is not lower than V1's.

Anything else counts as "not clearly better", and the recommendation is to stop work on the product and keep
only the test kit and the crawler. A second reviewer per plan is added only if rule 1 or 2 misses by one step
(25 to 30% fewer, or 8 of 12).

## Known limits, before the run

- 12 plans, one pass per arm, one reviewer per plan. The numbers of wrong claims are small.
- Plans are still read, not executed.
- Planners, checkers and reviewers are all Claude models.
- Blinding is weak: a version that mentions a catalog check can be recognised.
- The first test's reviewers may have been wrong about a fault; the new reviewer re-checks each one.
