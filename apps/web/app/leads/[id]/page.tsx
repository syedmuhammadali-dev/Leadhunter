import Link from "next/link";
import { notFound } from "next/navigation";
import { PriorityBadge, StatusBadge, WebsiteStatusBadge } from "@/components/badges";
import { LEADS } from "@/lib/fake-data";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = LEADS.find((l) => l.id === id);
  if (!lead) notFound();

  const info: [string, string][] = [
    ["Category", lead.category],
    ["Location", `${lead.city}, ${lead.country}`],
    ["Address", lead.address],
    ["Phone", lead.phone],
    ["Website", lead.website ?? "No website found"],
    ["Rating", `${lead.rating.toFixed(1)} (${lead.reviewCount} reviews)`],
    ["Source", lead.source],
    ["Researched", new Date(lead.researchedAt).toLocaleDateString("en-GB")],
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/leads" className="text-sm text-blue-700 hover:underline">← Back to leads</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{lead.name}</h1>
          <PriorityBadge priority={lead.priority} />
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
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Research priority score</h2>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {lead.score}
            <span className="text-base font-normal text-slate-500"> / {lead.maxScore}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Based on observable signals only. This is not a prediction that the business needs or will buy anything.
          </p>
          <h3 className="mt-4 text-sm font-medium">Why this score</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {lead.signals.length === 0 ? <li className="text-slate-500">No signals detected.</li> : null}
            {lead.signals.map((s) => (
              <li key={s.label} className="flex justify-between gap-4">
                <span>{s.label}</span>
                <span className="font-medium tabular-nums">+{s.weight}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Website audit</h2>
          {lead.audit ? (
            <Link href={`/leads/${lead.id}/audit`} className="text-sm text-blue-700 hover:underline">
              View full audit
            </Link>
          ) : null}
        </div>
        {lead.audit ? (
          <p className="mt-2 text-sm">
            Website score <strong>{lead.audit.websiteScore}/100</strong> with {lead.audit.issues.length} issue
            {lead.audit.issues.length === 1 ? "" : "s"} found.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            {lead.website ? "Website could not be reached, so no audit is available." : "No website, so there is nothing to audit."}
          </p>
        )}
      </section>
    </div>
  );
}
