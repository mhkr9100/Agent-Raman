// The scripted model shared by the engine test (engine-mock.ts) and the local mock LLM server
// (mock-llm-server.ts). Replies are routed by the tag on the first line of each system prompt.
export const PLANTED_KEY = "sk-" + "test0000PLANTED0000key0000";
export const REQUEST = [
  "Every 30 minutes, pull new leads from Apollo that match my saved search and post a short summary of them to our sales chat channel.",
  "Before building, look up the current API documentation of the lead database.",
  "Never email the leads directly. Keep a log of every run.",
  `My key is ${PLANTED_KEY} if you need it.`,
].join(" ");

const child = (o: Record<string, unknown>) => ({
  goal: "", category: "tools", priority: "must", kind_hint: "capability", criteria: [], proposed_names: [], depends_on: [], recurring: false,
  runtime: "executor_session", inputs: [], method: "Do it.", constraints: [], deliverable: "Result", contract: "JSON", destination: "workspace",
  side_effect: "none", rollback: "", check: "The result exists", on_fail: "Stop and report", enforcement: "instruction", ...o,
});

export type Route = (system: string, user: string) => unknown;
export const calls: Record<string, number> = {};

export const script: Route = (system, user) => {
  const tag = /^\[(raman:[a-z:-]+)\]/.exec(system)?.[1] ?? (system.includes("bind judge") ? "binder:judge" : system.includes("catalog search engine") ? "binder:expand" : "unknown");
  calls[tag] = (calls[tag] ?? 0) + 1;
  switch (tag) {
    case "raman:intake":
      return {
        summary: "A repeating job that posts a summary of new Apollo leads to the sales chat channel",
        spans: [
          { text: "pull new leads from Apollo that match my saved search", kind: "goal" },
          { text: "post a short summary of them to our sales chat channel", kind: "deliverable" },
          { text: "this quote is not in the request at all", kind: "constraint" },
          { text: "look up the current API documentation of the lead database", kind: "goal" },
        ],
        criteria: [
          { text: "New leads matching the saved search are fetched from Apollo", spans: [1] },
          { text: "A summary of the new leads is posted to the sales chat channel", spans: [2] },
          { text: "The plan is based on the current API documentation", spans: [4] },
        ],
        decisions: [],
        environment: { os: "", tools_present: [], notes: [] },
        out_of_scope: [],
        cadence: "",
      };
    case "raman:intake-gap":
      return { missed: [{ text: "No lead is ever emailed directly", quote: "Never email the leads directly" }, { text: "Invented requirement", quote: "send a fax to every lead" }] };
    case "raman:split-root":
      return {
        leaf: "none", leaf_reason: "", refinement: "AND",
        children: [
          child({ goal: "Fetch the new leads that match the saved search from the lead database", criteria: ["C1"], proposed_names: ["Apollo Lead Webhook Pro 9000"], recurring: true, category: "tools",
            inputs: [{ name: "Apollo API key", type: "credential", detail: "From the Apollo account settings", env_var: "apollo-api-key" }], side_effect: "none" }),
          child({ goal: "Write the summary of the new leads and send it to the sales chat channel", criteria: ["C2", "C4"], recurring: true, depends_on: [1], side_effect: "external_write", rollback: "Delete the posted message" }),
          child({ goal: "Look up current, version-specific documentation for a library or API", criteria: ["C3"], proposed_names: ["Context7"], category: "tools" }),
          child({ goal: "Approve the first posted summary before the schedule is switched on", kind_hint: "human", runtime: "human", criteria: ["C2"] }),
          child({ goal: "Keep a file of lead ids already posted so no lead is posted twice", kind_hint: "artifact", recurring: true, criteria: ["C2"], side_effect: "local_write", rollback: "Delete the file" }),
        ],
        not_applicable: [{ category: "packaging", why: "One agent is enough" }, { category: "licensing", why: "No policy beyond the constraints" }],
      };
    case "raman:split":
      return { leaf: "build", leaf_reason: "A short script with one HTTP call covers it.", refinement: "AND", children: [], not_applicable: [] };
    case "binder:expand":
      return { rewrites: ["tool for this need", "service that does this"], keywords: ["documentation lookup", "library docs"], ideal_tool: "An MCP server that returns up-to-date documentation for libraries and APIs." };
    case "binder:judge": {
      // Accept only for the one-off documentation need; everything else is "none" (no false bind).
      const docs = /Need:[^\n]*documentation/i.test(user) || /documentation for a library/i.test(user);
      return docs
        ? { verdict: "covers", primary: "C1", fallbacks: ["C2"], reason: "Returns current documentation for a named library.", scope_ok: true, constraint_conflicts: [], check: "Ask it for the docs of one library and get a non-empty answer", uncovered: [] }
        : { verdict: "none", primary: "", fallbacks: [], reason: "No item runs unattended on a schedule for this need.", scope_ok: false, constraint_conflicts: [], check: "", uncovered: ["the whole need"] };
    }
    case "raman:obstacles": {
      const keys = [...user.matchAll(/^Step ([\d.]+) \[/gm)].map((m) => m[1]);
      return {
        leaves: keys.map((key, i) => ({
          key, confidence: 0.8, reason: "Straightforward",
          obstacles: i === 0 && calls[tag] === 1
            ? [{ type: "access", resolution: "sibling_leaf", text: "The lead database account may lack API access", need: "Confirm the lead database plan includes API access and create the API key", kind_hint: "artifact" },
               { type: "rate_limit", resolution: "on_fail", text: "The API may rate-limit", need: "Wait and retry once, then stop", kind_hint: "capability" }]
            : [],
        })),
      };
    }
    case "raman:critic:auditor":
      return {
        proposals: calls[tag] > 1 ? [] : [
          // Planted hallucination: a product "fact" with a quote the page does not contain.
          { missing: "Apollo pushes a webhook for every new lead in a saved search, so polling is not needed", category: "tools", evidence: "url_quote", span: "", criterion_id: "", catalog_slug: "", quote: "Apollo sends a webhook for each new lead in a saved search", url: "https://docs.apollo.example.com/webhooks", target_key: "", need: "Subscribe to the Apollo new-lead webhook instead of polling", kind_hint: "capability" },
          // A real gap: the request says it, no criterion covers it.
          { missing: "Every run is logged", category: "telemetry", evidence: "span", span: "Keep a log of every run", criterion_id: "", catalog_slug: "", quote: "", url: "", target_key: "", need: "Append one line per run to a run log with time, lead count and outcome", kind_hint: "artifact" },
          { missing: "The plan should use a vector database", category: "tools", evidence: "none", span: "", criterion_id: "", catalog_slug: "", quote: "", url: "", target_key: "", need: "Store all leads in a vector database", kind_hint: "capability" },
        ],
      };
    case "raman:critic:premortem":
      return {
        proposals: calls[tag] > 1 ? [] : [
          { missing: "Apollo pushes a webhook for every new lead in a saved search, polling is not needed", category: "tools", evidence: "url_quote", span: "", criterion_id: "", catalog_slug: "", quote: "Apollo sends a webhook for each new lead in a saved search", url: "https://docs.apollo.example.com/webhooks", target_key: "", need: "Subscribe to the Apollo new-lead webhook rather than polling", kind_hint: "capability" },
        ],
      };
    default:
      throw new Error(`mock model: no route for system prompt starting "${system.slice(0, 60)}"`);
  }
};
