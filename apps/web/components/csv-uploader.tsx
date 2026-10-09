"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_CSV_BYTES } from "@leadhunter/shared";

interface Report {
  totalRows: number;
  validRows: number;
  inserted: number;
  duplicates: { line?: number; name: string; reason: string }[];
  invalid: { line: number; errors: string[] }[];
  fileErrors: string[];
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function CsvUploader() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function onFile(file: File | undefined) {
    setError(null);
    setReport(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) return setError("Please choose a .csv file.");
    if (file.size > MAX_CSV_BYTES) return setError("File is larger than 5 MB.");
    setBusy(true);
    try {
      const csvText = await file.text();
      const res = await fetch(`${API}/api/import/csv`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const body = await res.json();
      if (body.totalRows === undefined) throw new Error(body.error ?? "Import failed");
      setReport(body as Report);
      if ((body as Report).inserted > 0) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the API. Is it running on port 4000?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block rounded-lg border-2 border-dashed border-slate-300 bg-white p-6 text-center text-sm">
        <span className="font-medium">{busy ? "Importing..." : "Choose a CSV file to import"}</span>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          className="mt-3 block w-full text-sm"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>

      {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}

      {report ? (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm" data-testid="import-report">
          {report.fileErrors.length > 0 ? (
            <ul className="text-red-700">{report.fileErrors.map((m) => <li key={m}>{m}</li>)}</ul>
          ) : (
            <p>
              <strong>{report.inserted}</strong> imported, <strong>{report.duplicates.length}</strong> duplicates skipped,{" "}
              <strong>{report.invalid.length}</strong> invalid rows (of {report.totalRows} rows).
            </p>
          )}
          {report.invalid.length > 0 ? (
            <div>
              <h3 className="font-medium">Invalid rows</h3>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {report.invalid.slice(0, 20).map((r) => (
                  <li key={r.line}>Line {r.line}: {r.errors.join("; ")}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.duplicates.length > 0 ? (
            <div>
              <h3 className="font-medium">Duplicates skipped</h3>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {report.duplicates.slice(0, 20).map((d, i) => (
                  <li key={i}>{d.line ? `Line ${d.line}: ` : ""}{d.name} — {d.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
