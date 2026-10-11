import { isUsableKey } from "../security/internal-auth.js";

export interface N8nConfig {
  /** Production webhook URL of the "Lead Research" workflow, e.g. http://localhost:5678/webhook/lead-research */
  webhookUrl: string;
  /** Shared secret sent as x-webhook-secret; the workflow rejects requests without it. */
  webhookSecret: string | undefined;
  timeoutMs: number;
}

export type TriggerResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "not-configured" | "unreachable" | "not-found" | "rejected" | "failed" | "bad-response"; message: string };

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export function loadN8nConfig(env: Record<string, string | undefined> = process.env): N8nConfig {
  return {
    webhookUrl: env.N8N_WEBHOOK_URL || "http://localhost:5678/webhook/lead-research",
    webhookSecret: env.N8N_WEBHOOK_SECRET,
    timeoutMs: 20_000,
  };
}

/**
 * Start a research run by calling the n8n webhook. The workflow creates the SearchJob and answers
 * straight away with its id, then keeps working in the background.
 */
export async function triggerResearch(config: N8nConfig, payload: Record<string, unknown>, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<TriggerResult> {
  if (!isUsableKey(config.webhookSecret)) {
    return { ok: false, reason: "not-configured", message: "N8N_WEBHOOK_SECRET is not set to a real value (at least 16 characters) in .env" };
  }
  let url: URL;
  try {
    url = new URL(config.webhookUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    return { ok: false, reason: "not-configured", message: "N8N_WEBHOOK_URL is not a valid http(s) URL" };
  }

  try {
    const res = await fetchFn(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": config.webhookSecret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await res.text();
    if (res.status === 404) {
      return { ok: false, reason: "not-found", message: "n8n has no active webhook at this URL. Import the Lead Research workflow and turn it on (see n8n/README.md)." };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "rejected", message: "n8n rejected the request. N8N_WEBHOOK_SECRET in .env must match the one n8n runs with." };
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (JSON.parse(text) as { error?: string }).error ?? "";
      } catch {
        // not JSON
      }
      return { ok: false, reason: "failed", message: `n8n returned HTTP ${res.status}${detail ? `: ${detail}` : ""}` };
    }
    try {
      const jobId = (JSON.parse(text) as { jobId?: unknown }).jobId;
      if (typeof jobId === "string" && jobId.length > 0 && jobId.length <= 64) return { ok: true, jobId };
    } catch {
      // fall through
    }
    return { ok: false, reason: "bad-response", message: "n8n answered, but not with a jobId. Check that the workflow is the latest version from n8n/workflows." };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ok: false,
      reason: "unreachable",
      message: timedOut ? "n8n did not answer in time. Check that it is running and the workflow is active." : "Cannot reach n8n. Start it (see n8n/README.md) and try again.",
    };
  }
}
