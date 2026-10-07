import Link from "next/link";
import { HISTORY } from "@/lib/fake-data";

const STATUS_STYLE = {
  COMPLETED: "bg-emerald-100 text-emerald-800",
  RUNNING: "bg-blue-100 text-blue-800",
  FAILED: "bg-red-100 text-red-800",
} as const;

export default function HistoryPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Search History</h1>
        <p className="text-sm text-slate-500">Previous research jobs (fake development data).</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {["Date", "Search", "Max", "Status", "Businesses", "Websites", "Audits", "High priority", ""].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {HISTORY.map((j) => (
              <tr key={j.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(j.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}</td>
                <td className="px-3 py-2 font-medium">{j.category} in {j.city}, {j.country}</td>
                <td className="px-3 py-2 tabular-nums">{j.maxResults}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[j.status]}`}>{j.status}</span>
                </td>
                <td className="px-3 py-2 tabular-nums">{j.businessesFound}</td>
                <td className="px-3 py-2 tabular-nums">{j.websitesFound}</td>
                <td className="px-3 py-2 tabular-nums">{j.auditsCompleted}</td>
                <td className="px-3 py-2 tabular-nums">{j.highPriority}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/leads?${new URLSearchParams({ country: j.country, city: j.city, category: j.category })}`}
                    className="text-blue-700 hover:underline"
                  >
                    View leads
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
