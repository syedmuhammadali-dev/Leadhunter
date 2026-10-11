"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Re-scores every lead with the active scoring rules (useful after editing the scoring config file). */
export function RecalculateButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/api/scoring/recalculate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Recalculation failed");
      setMessage(`Scored ${body.scored} leads, ${body.changed} changed.`);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-slate-300"
      >
        {busy ? "Recalculating..." : "Recalculate all scores"}
      </button>
      {message ? <span role="status" className="text-sm text-slate-600">{message}</span> : null}
    </div>
  );
}
