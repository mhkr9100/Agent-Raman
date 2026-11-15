---
type: llm
---
PASS if the final answer is, or contains, a task file that (1) names where the schedule runs or asks the user what will start the task every 30 minutes when no agent session is open, (2) does not rely on an MCP server, skill or plugin inside an agent session to meet the 30 minute cadence, (3) carries the constraint that leads are never emailed, and (4) has a pass/fail check for each step.

FAIL if the task was executed (a message posted, a lead fetched), if the schedule question is missing, or if the answer is a plan written from memory without any catalog lookup.
