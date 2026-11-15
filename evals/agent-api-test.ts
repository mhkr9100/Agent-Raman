// Agent path test (MCP / v1): real catalog, real embeddings, no model. Checks the rules code must hold when the
// calling agent is the LLM: no bind for an id that is not in the catalog, no bind for an item that cannot run
// where the step runs, a scheduling step for every cadence, and no secret in the output. Stores nothing.
//   npm run test:agent
import { checkPlan, findCandidates, getItems, planSchema, renderPlan, type Plan } from "../src/lib/prism/agent-api";
import { embedQuery, serverDb } from "../src/lib/supabase-server";

const PLANTED_KEY = "sk-" + "test0000PLANTED0000key0000";
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const step = (over: Partial<Plan["steps"][number]>): Plan["steps"][number] => ({
  goal: "Do one thing", category: "tools", kind: "build", check: "The thing exists", criteria: ["C1"], ...over,
});

async function main() {
  const db = serverDb();

  // 1. Find
  const found = await findCandidates(db, embedQuery, {
    needs: [{ need: "Search the web and return result pages with their text", proposed_names: ["Definitely Not A Real Tool 9000"] }],
    executor: "claude_code", limit: 5,
  });
  const first = found.results[0];
  check("find returns usable candidates", first.usable > 0 && first.candidates.length > 0, `${first.usable} usable`);
  check("find reports a name that is not in the catalog", first.names_not_in_catalog.includes("Definitely Not A Real Tool 9000"));
  check("find output carries no raw auth values", first.candidates.every((c) => Array.isArray(c.auth.env) && Array.isArray(c.auth.headers)));
  const pick = first.candidates.find((c) => c.not_usable.length === 0 && c.runtime_compat.length === 1 && c.runtime_compat[0] === "executor_session") ?? first.candidates[0];
  console.log(`     picked ${pick.slug} (${pick.kind})`);

  const scheduled = await findCandidates(db, embedQuery, { needs: [{ need: "Search the web and return result pages with their text" }], executor: "claude_code", runtime: "scheduled_host", kinds: ["mcp_server"], limit: 5 });
  check("find under scheduled_host shows session-only items as not usable", scheduled.results[0].candidates.every((c) => c.not_usable.length > 0) && scheduled.results[0].usable === 0, `${scheduled.results[0].candidates.length} shown`);

  // 2. Get
  const got = await getItems(db, [pick.id, pick.slug, "no/such-item-anywhere"]);
  check("get resolves an id and a slug to one item", got.items.length === 1 && got.items[0].id === pick.id);
  check("get reports what is not found", got.not_found.length === 1 && got.not_found[0] === "no/such-item-anywhere");

  // 3. A clean one-off plan binds.
  const base: Plan = planSchema.parse({
    request: "Research the three largest competitors of Acme and write a one page summary with sources to summary.md",
    summary: "A one page competitor summary with sources exists in summary.md",
    executor: "claude_code",
    criteria: [
      { text: "The summary covers the three largest competitors", quote: "three largest competitors" },
      { text: "Every claim carries a source", quote: "with sources" },
    ],
    steps: [
      step({ goal: "Find current web pages about each competitor", kind: "capability", catalog_id: pick.id, reason: "It searches the web and returns page text, which is the whole need", criteria: ["C1", 2], check: "At least 3 pages per competitor are returned" }),
      step({ goal: "Write the summary with a source per claim", category: "model_instructions", depends_on: [1], criteria: ["C1", "C2"], side_effect: "local_write", rollback: "Delete summary.md", destination: "summary.md" }),
    ],
    not_applicable: CATS_NA(["tools", "model_instructions"]),
  });
  const ok = await checkPlan(db, base);
  check("a clean plan passes", ok.ok, ok.problems.join(" | "));
  check("the capability step is bound to the picked item", ok.steps[0].status === "bound" && ok.steps[0].item === pick.slug, `${ok.steps[0].status} ${ok.steps[0].item}`);

  const rendered = await renderPlan(db, base);
  check("render returns a task file naming the item", rendered.task_md.includes(pick.slug) || rendered.task_md.includes(pick.name), `${rendered.task_md.length} chars`);
  check("the file says who judged the bind", rendered.task_md.includes("Selected by the calling agent") && rendered.task_md.includes("calling agent"));

  // 4. An id that is not in the catalog never binds.
  const fake = structuredClone(base);
  fake.steps[0].catalog_id = "acme/imaginary-search-mcp";
  const f = await checkPlan(db, fake);
  check("an unknown id is not bound", !f.ok && f.steps[0].status === "unverified" && f.steps[0].item === null, f.steps[0].status);
  check("…and the problem says so", f.problems.some((p) => p.includes("not in the catalog")));
  const fmd = (await renderPlan(db, fake)).task_md;
  check("…and the rendered file does not list it as a capability to install", !/install[^\n]*imaginary-search-mcp/i.test(fmd));

  // 5. Cadence: a session-only item on a repeating step is refused; a scheduling step and its decision appear.
  const rec = structuredClone(base);
  rec.request = "Every 30 minutes, research the three largest competitors of Acme and write a one page summary with sources to summary.md";
  rec.steps[0].recurring = true;
  const r = await checkPlan(db, rec);
  check("a session-only item on a repeating step is not bound", !r.ok && r.steps[0].status === "unresolved" && r.steps[0].item === null, `${r.steps[0].status} runtime ${r.steps[0].runtime}`);
  check("a scheduling step was added by rule", r.steps.length === 3 && r.steps[2].runtime === "scheduled_host" && r.steps[2].status === "build", JSON.stringify(r.steps[2]));
  check("the missing scheduler host is a warning", r.warnings.some((w) => w.includes("D-sched")));
  const rmd = (await renderPlan(db, rec)).task_md;
  check("the file asks the scheduler question", rmd.includes("D-sched"));

  rec.steps[0] = step({ goal: "Fetch current web pages about each competitor with a script", recurring: true, criteria: ["C1", "C2"], check: "At least 3 pages per competitor are saved" });
  rec.scheduler_host = "GitHub Actions cron";
  const r2 = await checkPlan(db, rec);
  check("the same plan with a build step and a host passes", r2.ok, r2.problems.join(" | "));

  // 6. Gates: untraced criterion, empty category, missing check, side effect without rollback, bad dependency.
  const bad = structuredClone(base);
  bad.criteria.push({ text: "The summary is emailed to the team", quote: "nowhere in the request" });
  bad.not_applicable = bad.not_applicable!.filter((x) => x.category !== "security");
  bad.steps[1].rollback = "";
  bad.steps[1].depends_on = [7];
  bad.steps[1].check = "";
  bad.steps.push(step({ goal: "Do something nobody asked for", criteria: [] }));
  const b = await checkPlan(db, bad);
  const has = (s: string) => b.problems.some((p) => p.includes(s));
  check("untraced criterion is a problem", has("Criterion C3"));
  check("empty category is a problem", has("Category security"));
  check("side effect without rollback is a problem", has("no rollback"));
  check("bad dependency is a problem", has("depends_on 7"));
  check("missing check is a problem", has("no check"));
  check("a step serving no criterion is a problem", has("Step 3: serves no criterion"));
  check("a criterion with a false quote is marked inferred", b.warnings.some((w) => w.startsWith("C3 quotes words")));

  // 7. Secrets never come back.
  const leak = structuredClone(base);
  leak.request += ` My key is ${PLANTED_KEY}.`;
  leak.steps[1].method = `Use ${PLANTED_KEY} to call the API`;
  const l = await renderPlan(db, leak);
  check("secrets are removed from the file and reported", !l.task_md.includes(PLANTED_KEY) && !JSON.stringify(l).includes(PLANTED_KEY) && l.warnings.some((w) => w.includes("key-like")));
  const cred = structuredClone(base);
  cred.steps[1].inputs = [{ name: "API key", type: "credential", env_var: "this is the value" }];
  check("a credential without an env var name is a problem", (await checkPlan(db, cred)).problems.some((p) => p.includes("env_var")));

  console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

function CATS_NA(covered: string[]) {
  const all = ["model_instructions", "tools", "guardrails", "inputs_credentials", "output_destination", "acceptance_checks", "environment_runtime", "packaging", "telemetry", "security", "licensing", "freshness"];
  return all.filter((c) => !covered.includes(c)).map((category) => ({ category, why: "Not needed for a one-off local write" }));
}

main().catch((e) => { console.error(e); process.exit(1); });
