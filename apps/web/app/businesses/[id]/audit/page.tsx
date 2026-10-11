import Link from "next/link";
import { notFound } from "next/navigation";
import { SeverityBadge } from "@/components/badges";
import { RunAuditButton } from "@/components/run-audit-button";
import type { Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Issue {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  explanation: string;
  evidence: string | null;
  pointsDeducted: number;
}

interface Audit {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  usesHttps: boolean | null;
  redirectCount: number | null;
  websiteScore: number | null;
  scoreBreakdown: { rule: string; points: number; reason: string }[] | null;
  signals: {
    phones?: string[];
    emails?: string[];
    whatsappLinks?: string[];
    socialLinks?: { platform: string; url: string }[];
    contactPageUrl?: string | null;
    mapsLink?: string | null;
    bookingLink?: string | null;
    hasPricing?: boolean;
    linksChecked?: number;
    imagesChecked?: number;
  } | null;
  errorMessage: string | null;
  finishedAt: string | null;
  issues: Issue[];
}

interface Business {
  id: string;
  name: string;
  website: string | null;
  category: string;
  location: { city: string; country: string } | null;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const STATUS_TEXT: Record<Audit["status"], string> = {
  PENDING: "Waiting to start",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export default async function BusinessAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [business, audits] = await Promise.all([get<Business>(`/api/businesses/${encodeURIComponent(id)}`), get<Audit[]>(`/api/businesses/${encodeURIComponent(id)}/audits`)]);
  if (!business) notFound();
  const audit = audits?.[0] ?? null;
  const total = audit?.issues.reduce((s, i) => s + i.pointsDeducted, 0) ?? 0;
  const found = (label: string, values: string[] | undefined) => (values && values.length > 0 ? [label, values.join(", ")] as const : null);
  const signalRows = audit?.signals
    ? [
        found("Phone numbers", audit.signals.phones),
        found("Emails", audit.signals.emails),
        found("WhatsApp", audit.signals.whatsappLinks),
        found("Social profiles", audit.signals.socialLinks?.map((s) => s.platform)),
        audit.signals.contactPageUrl ? (["Contact page", audit.signals.contactPageUrl] as const) : null,
        audit.signals.mapsLink ? (["Google Maps", audit.signals.mapsLink] as const) : null,
        audit.signals.bookingLink ? (["Booking", audit.signals.bookingLink] as const) : null,
        ["Pricing visible", audit.signals.hasPricing ? "Yes" : "No"] as const,
        ["Links / images checked", `${audit.signals.linksChecked ?? 0} / ${audit.signals.imagesChecked ?? 0}`] as const,
      ].filter((r): r is readonly [string, string] => r !== null)
    : [];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/import" className="text-sm text-blue-700 hover:underline">← Back to imported businesses</Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Website audit</h1>
            <p className="text-sm text-slate-500">
              {business.name} · {business.category}
              {business.location ? ` · ${business.location.city}, ${business.location.country}` : ""}
            </p>
            <p className="text-sm text-slate-500">{business.website ?? "No website"}</p>
          </div>
          <RunAuditButton businessId={business.id} hasWebsite={!!business.website} label={audit ? "Run again" : "Run Audit"} />
        </div>
      </div>

      {!audit ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {business.website ? "No audit has been run yet. Click Run Audit to check the homepage." : "This business has no website, so there is nothing to audit."}
        </p>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">Website score</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {audit.websiteScore ?? "—"}
                {audit.websiteScore !== null ? <span className="text-base font-normal text-slate-500"> / 100</span> : null}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">Status</p>
              <p className="mt-1 text-xl font-semibold">{STATUS_TEXT[audit.status]}</p>
              <p className="text-xs text-slate-500">
                {audit.httpStatus ? `HTTP ${audit.httpStatus} · ${audit.usesHttps ? "HTTPS" : "No HTTPS"}` : ""}
                {audit.redirectCount ? ` · ${audit.redirectCount} redirect(s)` : ""}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">Final URL</p>
              <p className="mt-1 break-all text-sm">{audit.finalUrl ?? audit.url}</p>
            </div>
          </section>

          {audit.errorMessage ? (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              {audit.status === "SKIPPED" ? "Skipped: " : "Could not complete: "}
              {audit.errorMessage}
            </p>
          ) : null}

          {audit.status === "COMPLETED" ? (
            <>
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="font-semibold">How the score was calculated</h2>
                <p className="mt-1 text-sm text-slate-500">Starts at 100. Every issue below deducts points (the score never goes below 0).</p>
                <table className="mt-3 w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    <tr><td className="py-2">Starting score</td><td className="py-2 text-right tabular-nums">100</td></tr>
                    {(audit.scoreBreakdown ?? []).map((b) => (
                      <tr key={b.rule}>
                        <td className="py-2">{b.reason}</td>
                        <td className="py-2 text-right tabular-nums text-red-700">{b.points}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-2">Final score{total > 100 ? ` (${100 - total} raised to 0)` : ""}</td>
                      <td className="py-2 text-right tabular-nums">{audit.websiteScore}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="font-semibold">Issues ({audit.issues.length})</h2>
                {audit.issues.length === 0 ? <p className="mt-2 text-sm text-slate-500">No issues detected.</p> : null}
                <ul className="mt-3 space-y-3">
                  {audit.issues.map((i) => (
                    <li key={i.id} className="rounded-md border border-slate-100 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={i.severity} />
                        <span className="font-medium">{i.title}</span>
                        <span className="ml-auto text-slate-500">-{i.pointsDeducted} pts</span>
                      </div>
                      <p className="mt-1 text-slate-600">{i.explanation}</p>
                      {i.evidence ? <p className="mt-1 break-all font-mono text-xs text-slate-500">Evidence: {i.evidence}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>

              {signalRows.length > 0 ? (
                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <h2 className="font-semibold">Observed on the homepage</h2>
                  <dl className="mt-3 space-y-2 text-sm">
                    {signalRows.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4">
                        <dt className="text-slate-500">{k}</dt>
                        <dd className="break-all text-right">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
