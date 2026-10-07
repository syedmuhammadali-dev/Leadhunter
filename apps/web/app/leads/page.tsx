import Link from "next/link";
import { PriorityBadge, StatusBadge, WebsiteStatusBadge } from "@/components/badges";
import { PAGE_SIZE, QUICK_FILTERS, leadsHref, parseQuery, queryLeads, type SearchParams, type SortKey } from "@/lib/query";

const COLUMNS: { label: string; sort?: SortKey }[] = [
  { label: "Business", sort: "name" },
  { label: "Category" },
  { label: "City" },
  { label: "Website" },
  { label: "Rating", sort: "rating" },
  { label: "Reviews", sort: "reviews" },
  { label: "Website Status", sort: "websiteScore" },
  { label: "Lead Score", sort: "score" },
  { label: "Main Problems" },
  { label: "Status" },
];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const q = parseQuery(await searchParams);
  const { rows, total, pages, page } = queryLeads(q);
  const activeFilters = [q.country, q.city, q.category].filter(Boolean).join(" / ");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Leads</h1>
        <p className="text-sm text-slate-500">
          {total} lead{total === 1 ? "" : "s"}
          {activeFilters ? ` for ${activeFilters}` : ""}. Scores show research priority from observable signals only.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="filter" value={q.filter} />
        <input type="hidden" name="country" value={q.country} />
        <input type="hidden" name="city" value={q.city} />
        <input type="hidden" name="category" value={q.category} />
        <input type="hidden" name="limit" value={q.limit || ""} />
        <input
          name="q"
          defaultValue={q.q}
          placeholder="Search name, category, city"
          aria-label="Search leads"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:w-72"
        />
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick filters">
        {QUICK_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={leadsHref(q, { filter: f.value, page: 1 })}
            aria-current={q.filter === f.value ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              q.filter === f.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} className="px-3 py-2 font-medium">
                  {c.sort ? (
                    <Link
                      href={leadsHref(q, { sort: c.sort, dir: q.sort === c.sort && q.dir === "desc" ? "asc" : "desc", page: 1 })}
                      className="hover:text-slate-900"
                    >
                      {c.label}
                      {q.sort === c.sort ? (q.dir === "desc" ? " ↓" : " ↑") : ""}
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/leads/${l.id}`} className="text-blue-700 hover:underline">{l.name}</Link>
                </td>
                <td className="px-3 py-2">{l.category}</td>
                <td className="px-3 py-2">{l.city}</td>
                <td className="max-w-40 truncate px-3 py-2">{l.website ? l.website.replace("https://", "") : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{l.rating.toFixed(1)}</td>
                <td className="px-3 py-2 tabular-nums">{l.reviewCount}</td>
                <td className="px-3 py-2">
                  <WebsiteStatusBadge status={l.websiteStatus} />
                  {l.audit ? <span className="ml-1 text-xs text-slate-500">{l.audit.websiteScore}/100</span> : null}
                </td>
                <td className="px-3 py-2">
                  <span className="mr-1 tabular-nums">{l.score}/{l.maxScore}</span>
                  <PriorityBadge priority={l.priority} />
                </td>
                <td className="max-w-56 px-3 py-2 text-slate-600">{l.problems.slice(0, 2).join(", ") || "None detected"}</td>
                <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-slate-500">
                  No leads match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">
          Page {page} of {pages} ({PAGE_SIZE} per page)
        </span>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link href={leadsHref(q, { page: page - 1 })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-100">
              Previous
            </Link>
          ) : null}
          {page < pages ? (
            <Link href={leadsHref(q, { page: page + 1 })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-100">
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
