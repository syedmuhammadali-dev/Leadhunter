import Link from "next/link";
import { healthResponseSchema } from "@leadhunter/shared";
import { PriorityBadge } from "@/components/badges";
import { LEADS } from "@/lib/fake-data";

export const dynamic = "force-dynamic";

async function getHealth() {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    return healthResponseSchema.parse(await res.json());
  } catch {
    return null;
  }
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default async function Home() {
  const health = await getHealth();
  const high = LEADS.filter((l) => l.priority === "HIGH");
  const medium = LEADS.filter((l) => l.priority === "MEDIUM").length;
  const low = LEADS.filter((l) => l.priority === "LOW").length;
  const noSite = LEADS.filter((l) => l.website === null).length;
  const avg = (LEADS.reduce((s, l) => s + l.score, 0) / LEADS.length).toFixed(1);
  const top = [...high].sort((a, b) => b.score - a.score).slice(0, 5);
  const bars = [
    { label: "High", count: high.length, color: "bg-red-500" },
    { label: "Medium", count: medium, color: "bg-amber-500" },
    { label: "Low", count: low, color: "bg-slate-400" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-500">Research overview. Showing fake development data.</p>
        </div>
        <Link href="/search" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          New search
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total leads" value={LEADS.length} />
        <Stat label="High priority" value={high.length} hint="Research priority, not a purchase prediction" />
        <Stat label="No website" value={noSite} />
        <Stat label="Average score" value={`${avg} / 20`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="font-semibold">Top research priorities</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {top.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/leads/${l.id}`} className="min-w-0 truncate font-medium text-blue-700 hover:underline">
                  {l.name}
                </Link>
                <span className="hidden text-slate-500 sm:inline">{l.city}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{l.score}/{l.maxScore}</span>
                  <PriorityBadge priority={l.priority} />
                </span>
              </li>
            ))}
          </ul>
          <Link href="/leads?filter=high" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            View all high priority leads
          </Link>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Priority breakdown</h2>
          <div className="mt-3 space-y-3">
            {bars.map((b) => (
              <div key={b.label}>
                <div className="flex justify-between text-sm">
                  <span>{b.label}</span>
                  <span className="tabular-nums">{b.count}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${b.color}`} style={{ width: `${(b.count / LEADS.length) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4" data-testid="health-card">
        <h2 className="font-semibold">API status</h2>
        {health ? (
          <ul className="mt-2 text-sm">
            <li>API: {health.status}</li>
            <li>Database: {health.database}</li>
            <li>Checked: {health.time}</li>
          </ul>
        ) : (
          <p className="mt-2 text-sm text-red-600">API unreachable. Is it running on port 4000?</p>
        )}
      </section>
    </div>
  );
}
