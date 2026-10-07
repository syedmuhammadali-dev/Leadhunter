import { SCORING_WEIGHTS } from "@/lib/fake-data";

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500">Read-only for now. Editing arrives with the scoring system and providers in later phases.</p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Business data provider</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Active provider</dt><dd>Mock (development)</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Available soon</dt><dd>CSV import</dd></div>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Lead priority scoring weights</h2>
        <p className="mt-1 text-xs text-slate-500">
          Scores rank research priority from observable signals. They do not predict whether a business will buy.
        </p>
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {SCORING_WEIGHTS.map((w) => (
              <tr key={w.label}>
                <td className="py-2">{w.label}</td>
                <td className="py-2 text-right tabular-nums">+{w.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Safety</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>LeadHunter never sends emails, WhatsApp messages or DMs automatically.</li>
          <li>Outreach text is only ever a draft for your manual review.</li>
          <li>Only public business-level information is collected.</li>
        </ul>
      </section>
    </div>
  );
}
