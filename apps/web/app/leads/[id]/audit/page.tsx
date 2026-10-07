import Link from "next/link";
import { notFound } from "next/navigation";
import { SeverityBadge } from "@/components/badges";
import { LEADS } from "@/lib/fake-data";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = LEADS.find((l) => l.id === id);
  if (!lead) notFound();
  const audit = lead.audit;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/leads/${lead.id}`} className="text-sm text-blue-700 hover:underline">← Back to {lead.name}</Link>
        <h1 className="mt-2 text-2xl font-bold">Website audit</h1>
        <p className="text-sm text-slate-500">{lead.name}</p>
      </div>

      {!audit ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {lead.website ? "The website could not be reached, so no audit is available." : "This business has no website, so there is nothing to audit."}
        </p>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">Website score</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{audit.websiteScore}<span className="text-base font-normal text-slate-500"> / 100</span></p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">HTTP status</p>
              <p className="mt-1 text-xl font-semibold">{audit.httpStatus}</p>
              <p className="text-xs text-slate-500">{audit.usesHttps ? "HTTPS" : "No HTTPS"}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">URL</p>
              <p className="mt-1 break-all text-sm">{audit.url}</p>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">How the score was calculated</h2>
            <p className="mt-1 text-sm text-slate-500">Starts at 100. Each issue below deducts points.</p>
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2">Starting score</td>
                  <td className="py-2 text-right tabular-nums">100</td>
                </tr>
                {audit.issues.map((i) => (
                  <tr key={i.type}>
                    <td className="py-2">{i.title}</td>
                    <td className="py-2 text-right tabular-nums text-red-700">-{i.pointsDeducted}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2">Final score</td>
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
                <li key={i.type} className="rounded-md border border-slate-100 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={i.severity} />
                    <span className="font-medium">{i.title}</span>
                    <span className="ml-auto text-slate-500">-{i.pointsDeducted} pts</span>
                  </div>
                  <p className="mt-1 text-slate-600">{i.explanation}</p>
                  {i.evidence ? <p className="mt-1 font-mono text-xs text-slate-500">Evidence: {i.evidence}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
