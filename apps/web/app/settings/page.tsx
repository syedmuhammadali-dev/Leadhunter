import { RecalculateButton } from "@/components/recalculate-button";
import { getScoringConfig } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const result = await getScoringConfig();
  const config = result.ok ? result.data : null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500">Read-only view of the active configuration.</p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Business data provider</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Available</dt><dd>Mock (development), CSV import (see Import CSV)</dd></div>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Lead priority scoring</h2>
        <p className="mt-1 text-xs text-slate-500">
          Scores rank research priority from observable signals. They do not predict whether a business will buy.
        </p>
        {!config ? (
          <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">Could not load the scoring rules. Is the API running on port 4000?</p>
        ) : (
          <>
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {Object.entries(config.signals).map(([key, s]) => (
                  <tr key={key}>
                    <td className="py-2">{s.label}</td>
                    <td className="py-2 text-right tabular-nums">+{s.weight}</td>
                  </tr>
                ))}
                {config.presence.map((p) => (
                  <tr key={p.minReviews}>
                    <td className="py-2">{p.label} ({p.minReviews}+ reviews)</td>
                    <td className="py-2 text-right tabular-nums">+{p.weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">High priority from</dt><dd className="tabular-nums">{config.thresholds.high} points</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Medium priority from</dt><dd className="tabular-nums">{config.thresholds.medium} points</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Highest possible score</dt><dd className="tabular-nums">{config.maximumScore}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Rules version</dt><dd className="font-mono">{config.version}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-slate-500">
              To change weights, create a JSON file with only the values to override, set <code>SCORING_CONFIG_PATH</code> in <code>.env</code> to its path,
              restart the API, then recalculate. See <code>docs/scoring.md</code>.
            </p>
            <div className="mt-3"><RecalculateButton /></div>
          </>
        )}
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
