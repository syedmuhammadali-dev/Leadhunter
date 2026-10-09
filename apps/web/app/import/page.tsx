import { CsvUploader } from "@/components/csv-uploader";

export const dynamic = "force-dynamic";

interface ImportedBusiness {
  id: string;
  name: string;
  category: string;
  website: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  location: { city: string; country: string } | null;
}

async function getImported(): Promise<{ total: number; items: ImportedBusiness[] } | null> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${base}/api/businesses?source=csv&pageSize=50`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function ImportPage() {
  const imported = await getImported();
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import CSV</h1>
        <p className="text-sm text-slate-500">
          Upload a CSV of businesses you are allowed to use. Rows are validated and duplicates are skipped.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">Expected columns</h2>
        <p className="mt-1 text-slate-600">
          Required: <code>name</code>, <code>category</code>, <code>country</code>, <code>city</code>. Optional: <code>address</code>,{" "}
          <code>website</code>, <code>phone</code>, <code>email</code>, <code>rating</code> (0–5), <code>reviewCount</code>,{" "}
          <code>facebook</code>, <code>instagram</code>, <code>linkedin</code>. Max 5 MB / 5000 rows.
        </p>
        <a href="/sample-leads.csv" download className="mt-2 inline-block text-blue-700 hover:underline">
          Download sample CSV
        </a>
      </section>

      <CsvUploader />

      <section>
        <h2 className="font-semibold">Imported businesses {imported ? `(${imported.total})` : ""}</h2>
        {imported === null ? (
          <p className="mt-2 text-sm text-red-600">Could not load imported businesses. Is the API running on port 4000?</p>
        ) : imported.items.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nothing imported yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {["Business", "Category", "City", "Country", "Website", "Rating", "Reviews"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {imported.items.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-medium">{b.name}</td>
                    <td className="px-3 py-2">{b.category}</td>
                    <td className="px-3 py-2">{b.location?.city}</td>
                    <td className="px-3 py-2">{b.location?.country}</td>
                    <td className="max-w-48 truncate px-3 py-2">{b.website ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{b.rating ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{b.reviewCount ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
