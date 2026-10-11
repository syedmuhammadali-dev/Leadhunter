import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { newJobSchema } from "./internal-routes.js";

interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  onError?: string;
}
interface Workflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: { node: string }[][] }>;
  active: boolean;
}

const file = resolve(__dirname, "../../../n8n/workflows/lead-research.json");
const workflow = JSON.parse(readFileSync(file, "utf8")) as Workflow;
const byName = new Map(workflow.nodes.map((n) => [n.name, n]));
const apiCalls = workflow.nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest");

describe("Lead Research workflow JSON", () => {
  it("is an importable, inactive workflow with unique node names and ids", () => {
    expect(workflow.name).toBe("Lead Research");
    expect(workflow.active).toBe(false);
    expect(byName.size).toBe(workflow.nodes.length);
    expect(new Set(workflow.nodes.map((n) => n.id)).size).toBe(workflow.nodes.length);
  });

  it("has a POST webhook that answers through a Respond to Webhook node", () => {
    const hook = workflow.nodes.find((n) => n.type === "n8n-nodes-base.webhook")!;
    expect(hook.parameters).toMatchObject({ httpMethod: "POST", path: "lead-research", responseMode: "responseNode" });
    expect(workflow.nodes.filter((n) => n.type === "n8n-nodes-base.respondToWebhook").length).toBeGreaterThanOrEqual(4);
  });

  it("only connects nodes that exist, and every node is reachable from the webhook", () => {
    const reachable = new Set<string>(["Webhook"]);
    const queue = ["Webhook"];
    while (queue.length) {
      const from = queue.pop()!;
      for (const outputs of workflow.connections[from]?.main ?? []) {
        for (const link of outputs) {
          expect(byName.has(link.node), `${from} -> ${link.node}`).toBe(true);
          if (!reachable.has(link.node)) {
            reachable.add(link.node);
            queue.push(link.node);
          }
        }
      }
    }
    for (const name of Object.keys(workflow.connections)) expect(byName.has(name), name).toBe(true);
    const unreachable = workflow.nodes.filter((n) => n.type !== "n8n-nodes-base.stickyNote" && !reachable.has(n.name)).map((n) => n.name);
    expect(unreachable).toEqual([]);
  });

  it("follows the required research steps in order", () => {
    const path = ["Webhook", "Check secret", "Validate input", "Input valid?", "Create SearchJob", "Respond: job started", "Search provider", "Save and de-duplicate", "Websites to audit?", "One item per website", "Audit website (one at a time)", "Collect audit results", "Calculate lead scores", "Complete job", "Final statistics"];
    for (let i = 0; i < path.length - 1; i++) {
      const targets = (workflow.connections[path[i]!]?.main ?? []).flat().map((l) => l.node);
      expect(targets, `${path[i]} should lead to ${path[i + 1]}`).toContain(path[i + 1]);
    }
    // With nothing to audit the flow skips straight to scoring.
    expect((workflow.connections["Websites to audit?"]!.main[1] ?? []).map((l) => l.node)).toEqual(["Calculate lead scores"]);
  });

  it("rejects calls without the shared secret and checks it from the environment, not a literal", () => {
    const check = JSON.stringify(byName.get("Check secret")!.parameters);
    expect(check).toContain("$env.N8N_WEBHOOK_SECRET");
    expect(check).toContain("x-webhook-secret");
    expect((workflow.connections["Check secret"]!.main[1] ?? []).map((l) => l.node)).toEqual(["Respond: unauthorized"]);
    expect(byName.get("Respond: unauthorized")!.parameters).toMatchObject({ options: { responseCode: 401 } });
  });

  it("calls only the LeadHunter internal API, always with the API key from the environment", () => {
    expect(apiCalls.length).toBeGreaterThanOrEqual(7);
    const suffixes = new Set<string>();
    for (const n of apiCalls) {
      const p = JSON.stringify(n.parameters);
      expect(p, n.name).toContain("$env.LEADHUNTER_API_URL");
      expect(p, n.name).toContain("/internal/jobs");
      expect(p, n.name).toMatch(/"name":"x-api-key","value":"=\{\{ \$env\.INTERNAL_API_KEY \}\}"/);
      expect(n.parameters.method, n.name).toBe("POST");
      const m = /\/internal\/jobs(?:\/' \+ [^+]+ \+ '\/(\w+))?'/.exec(String(n.parameters.url));
      suffixes.add(m?.[1] ?? "create");
    }
    expect([...suffixes].sort()).toEqual(["audit", "complete", "create", "fail", "save", "score", "search"]);
  });

  it("contains no secret values and no messaging or outreach nodes", () => {
    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(/[0-9a-f]{32,}/i);
    const forbidden = /email|gmail|smtp|slack|telegram|whatsapp|twilio|sendgrid|mailchimp|discord|sms|outlook|facebook|instagram|linkedin|twitter/i;
    for (const n of workflow.nodes) {
      expect(n.type, n.name).not.toMatch(forbidden);
      if (n.type !== "n8n-nodes-base.stickyNote") expect(n.name, n.name).not.toMatch(forbidden);
    }
  });

  it("audits one site at a time with a pause between sites, and a failed audit does not stop the run", () => {
    const audit = byName.get("Audit website (one at a time)")!;
    expect(audit.parameters.options).toMatchObject({ batching: { batch: { batchSize: 1, batchInterval: 1000 } } });
    expect(audit.onError).toBe("continueRegularOutput");
  });

  it("marks the job as failed when search, save, scoring or completion fail", () => {
    for (const name of ["Search provider", "Save and de-duplicate", "Calculate lead scores", "Complete job"]) {
      expect(byName.get(name)!.onError, name).toBe("continueErrorOutput");
      const errorOutput = workflow.connections[name]!.main[1]!.map((l) => l.node);
      expect(errorOutput, name).toEqual(["Mark job failed"]);
    }
  });

  it("validates input the same way as the API", () => {
    const code = String(byName.get("Validate input")!.parameters.jsCode);
    const run = (body: unknown) => {
      const fn = new Function("$input", code) as (i: { first(): { json: unknown } }) => { json: { ok: boolean; errors: string[]; input: unknown } }[];
      return fn({ first: () => ({ json: { body } }) })[0]!.json;
    };
    const cases: unknown[] = [
      { country: "UAE", city: "Dubai", category: "Cafe", limit: 50 },
      { country: " UAE ", city: "Dubai", category: "Cafe", limit: 1, provider: "mock" },
      { country: "UAE", city: "Dubai", category: "Cafe", limit: 500 },
      { country: "UAE", city: "Dubai", category: "Cafe", limit: 0 },
      { country: "UAE", city: "Dubai", category: "Cafe", limit: 501 },
      { country: "UAE", city: "Dubai", category: "Cafe", limit: 2.5 },
      { country: "UAE", city: "Dubai", category: "Cafe" },
      { country: "", city: "Dubai", category: "Cafe", limit: 5 },
      { country: "UAE", city: "x".repeat(101), category: "Cafe", limit: 5 },
      { country: "UAE", city: "Dubai", category: "Cafe", limit: 5, provider: "csv" },
      { country: 5, city: "Dubai", category: "Cafe", limit: 5 },
      {},
      undefined,
    ];
    for (const body of cases) {
      const fromWorkflow = run(body);
      const fromApi = newJobSchema.safeParse(body);
      expect(fromWorkflow.ok, JSON.stringify(body)).toBe(fromApi.success);
      if (fromApi.success) expect(fromWorkflow.input).toEqual(fromApi.data);
      else expect(fromWorkflow.errors.length).toBeGreaterThan(0);
    }
  });
});
