export const meta = {
  name: 'raman-ab-generate',
  description: 'Clean-room agents plan six requests with and without Agent Raman, on two models',
  phases: [
    { title: 'Sonnet', detail: '6 requests x 2 arms', model: 'sonnet' },
    { title: 'Haiku', detail: '6 requests x 2 arms', model: 'haiku' },
  ],
}

const COMMON = (request) => `A user works in Claude Code. They wrote the request below. Do NOT carry out the task. Your job is to produce the plan file (task.md) that the user will hand to a fresh Claude Code session to execute later.

The plan must name the specific capabilities the task needs (MCP servers, skills, plugins, CLIs, APIs, models), say how to install or connect each one, list inputs and credentials (environment variable NAMES only), give the steps in order with one pass/fail check per step, and say plainly what you could not resolve or verify.

Rules for this session:
- This is a clean-room test. Do not read, search or list any files on this machine. Work from the request only.
- You may use web search and web fetch if you have them, and Bash only for curl.
- Do not use any other MCP tools that happen to be connected to this session.
- Do not ask questions. Where the user would have to decide something, write the question into the plan with a default.

The user's request:
"""
${request}
"""
`

const ARM_A = (request) => COMMON(request) + `
Reply with the complete task.md as your final message and nothing else.`

const ARM_B = (request, label) => COMMON(request) + `
Use Agent Raman to make this plan. Agent Raman is a planning service running at http://localhost:3100.
1. Read its method first: curl -s 'http://localhost:3100/api/v1/guide' . Follow it fully.
2. Where the method names the tools raman_find, raman_get, raman_check and raman_render, call them over HTTP with POST and a JSON body:
   - http://localhost:3100/api/v1/find?run=${label}    body: {"needs":[{"need":"...","proposed_names":["..."]}],"executor":"claude_code","runtime":"executor_session" or "scheduled_host","limit":6}  (1 to 5 needs per call; proposed_names, runtime and limit are optional)
   - http://localhost:3100/api/v1/get?run=${label}     body: {"ids":["<id or slug>"]}
   - http://localhost:3100/api/v1/check?run=${label}   body: the plan JSON described in the method
   - http://localhost:3100/api/v1/render?run=${label}  body: the same plan JSON
   Send the body with a heredoc, for example: curl -s -X POST '<url>' -H 'Content-Type: application/json' -d @- <<'JSON' ... JSON
   Keep ?run=${label} on every call, exactly as written.
3. Finish only after /render has returned a task_md. The service saves the rendered file, so do not retype it.

Reply with one line saying RENDERED (or FAILED), then at most five short lines on anything that did not work or that you could not resolve.`

const tasks = args.tasks
const jobs = []
for (const model of ['sonnet', 'haiku']) {
  for (const t of tasks) {
    for (const arm of ['A', 'B']) {
      const label = `${arm}-${t.id}-${model}`
      jobs.push({ label, model, arm, t })
    }
  }
}

const out = await parallel(jobs.map(j => () =>
  agent(j.arm === 'A' ? ARM_A(j.t.request) : ARM_B(j.t.request, j.label), {
    label: j.label,
    phase: j.model === 'sonnet' ? 'Sonnet' : 'Haiku',
    model: j.model,
    agentType: 'Plan',
  }).then(text => ({ label: j.label, chars: (text || '').length, head: (text || '').slice(0, 160), tail: j.arm === 'B' ? (text || '').slice(0, 700) : '' }))
))
return out.map((r, i) => r || { label: jobs[i].label, chars: 0, head: 'NULL (agent failed or was skipped)', tail: '' })
