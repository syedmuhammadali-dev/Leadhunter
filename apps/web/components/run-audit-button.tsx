"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const POLL_MS = 1500;
const GIVE_UP_MS = 120_000;

export function RunAuditButton({ businessId, hasWebsite, label = "Run Audit" }: { businessId: string; hasWebsite: boolean; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function run() {
    setState("running");
    setMessage(null);
    try {
      const start = await fetch(`${API}/api/businesses/${businessId}/audit`, { method: "POST" });
      const started = await start.json();
      if (!start.ok) throw new Error(started.error ?? "Could not start the audit");

      const deadline = Date.now() + GIVE_UP_MS;
      while (!cancelled.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const res = await fetch(`${API}/api/audits/${started.auditId}`, { cache: "no-store" });
        const audit = await res.json();
        if (audit.status && audit.status !== "PENDING" && audit.status !== "RUNNING") {
          setState("idle");
          router.refresh();
          return;
        }
      }
      if (!cancelled.current) throw new Error("The audit is taking a long time. Refresh the page in a minute.");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Could not reach the API. Is it running on port 4000?");
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={!hasWebsite || state === "running"}
        title={hasWebsite ? undefined : "This business has no website to audit"}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {state === "running" ? "Auditing..." : label}
      </button>
      {message ? <span role="alert" className="max-w-56 text-xs text-red-700">{message}</span> : null}
    </span>
  );
}
