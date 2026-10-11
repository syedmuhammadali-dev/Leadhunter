import Link from "next/link";
import { notFound } from "next/navigation";
import { PriorityBadge, StatusBadge, WebsiteStatusBadge } from "@/components/badges";
import { getLead } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLead(id);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
        Could not load this lead{result.status ? ` (API error ${result.status})` : ". Is the API running on port 4000?"}.
      </p>
    );
  }
  const lead = result.data;
  const s = lead.latestScore;
  const matched = s?.details.signals.filter((x) => x.matched && x.weight > 0) ?? [];
  const notMatched = s?.details.signals.filter((x) => !x.matched && x.evaluated) ?? [];
  const unchecked = s?.details.signals.filter((x) => !x.evaluated) ?? [];

  const info: [string, string][] = [
    ["Category", lead.category],
    ["Location", `${lead.city}, ${lead.country}`],
    ["Address", lead.address ?? "—"],
    ["Phone", lead.phone ?? "—"],
    ["Email", lead.email ?? "—"],
    ["Website", lead.website ?? "No website found"],
    ["Rating", lead.rating !== null ? `${lead.rating.toFixed(1)} (${lead.reviewCount ?? 0} reviews)` : lead.reviewCount !== null ? `${lead.reviewCount} reviews` : "—"],
    ["Source", lead.source],
    ["Last audited", lead.lastAuditedAt ? new Date(lead.lastAuditedAt).toLocaleDateString("en-GB") : "Never"],
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/leads" className="text-sm text-blue-700 hover:underline">← Back to leads</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{lead.name}</h1>
          {lead.priority ? <PriorityBadge priority={lead.priority} /> : null}
          <StatusBadge status={lead.status} />
          <WebsiteStatusBadge status={lead.websiteStatus} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Business information</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {info.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-all text-right">{v}</dd>
              </div>
            ))}
          </dl>
          {lead.contactMethods.length > 0 ? (
            <>
              <h3 className="mt-4 text-sm font-medium">Public contact details</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {lead.contactMethods.map((c) => (
                  <li key={`${c.type}-${c.value}`} className="flex justify-between gap-4">
                    <span className="text-slate-500">{c.type.replace("_", " ").toLowerCase()}</span>
                    <span className="break-all text-right">{c.value}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Research priority score</h2>
          {s ? (
            <>
              <p className="mt-2 text-3xl font-semibold tabular-nums">
                {s.score}
                <span className="text-base font-normal text-slate-500"> / {s.maximumScore}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Based on observable signals only. This is not a prediction that the business needs or will buy anything.
              </p>
              <h3 className="mt-4 text-sm font-medium">Why this score</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {matched.length === 0 ? <li className="text-slate-500">No signals added points.</li> : null}
                {matched.map((x) => (
                  <li key={x.signal} className="flex justify-between gap-4">
                    <span>{x.label}</span>
                    <span className="font-medium tabular-nums">+{x.weight}</span>
                  </li>
                ))}
              </ul>
              {notMatched.length > 0 ? (
                <p className="mt-3 text-xs text-slate-500">Checked, did not apply: {notMatched.map((x) => x.label).join("; ")}.</p>
              ) : null}
              {unchecked.length > 0 ? <p className="mt-1 text-xs text-slate-500">Not checked yet: {unchecked.map((x) => x.label).join("; ")}.</p> : null}
              {s.details.notes.map((n) => (
                <p key={n} className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">{n}</p>
              ))}
              <p className="mt-3 text-xs text-slate-400">
                Scored {new Date(s.calculatedAt).toLocaleString("en-GB")} · rules {s.configVersion ?? "unknown"}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">This lead has not been scored yet.</p>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Website audit</h2>
          {lead.website ? (
            <Link href={`/businesses/${lead.businessId}/audit`} className="text-sm text-blue-700 hover:underline">
              {lead.auditStatus ? "View full audit" : "Run audit"}
            </Link>
          ) : null}
        </div>
        {lead.auditStatus === "COMPLETED" ? (
          <p className="mt-2 text-sm">
            Website score <strong>{lead.websiteScore}/100</strong>
            {lead.problems.length > 0 ? `. Main problems: ${lead.problems.join(", ")}.` : ". No problems detected."}
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            {!lead.website ? "No website, so there is nothing to audit." : lead.auditStatus ? `Latest audit status: ${lead.auditStatus.toLowerCase()}.` : "This website has not been audited yet."}
          </p>
        )}
      </section>

      {lead.scoreHistory.length > 1 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Score history</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {lead.scoreHistory.map((h) => (
              <li key={h.calculatedAt} className="flex justify-between gap-4">
                <span className="text-slate-500">{new Date(h.calculatedAt).toLocaleString("en-GB")}</span>
                <span className="tabular-nums">{h.score} ({h.priority.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
