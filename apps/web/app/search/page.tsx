import { CATEGORIES, LOCATIONS } from "@/lib/fake-data";

const COUNTRIES = [...new Set(LOCATIONS.map((l) => l.country))];

const field = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";

export default function SearchPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Lead Search</h1>
        <p className="text-sm text-slate-500">
          Choose where to research. For now this filters fake development data; real providers and n8n come in later phases.
        </p>
      </div>

      <form action="/leads" method="get" className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <label className="block text-sm font-medium">
          Country
          <select name="country" defaultValue="United Arab Emirates" className={field}>
            <option value="">Any country</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium">
          City
          <input name="city" list="cities" defaultValue="Dubai" placeholder="e.g. Dubai" className={field} />
          <datalist id="cities">
            {LOCATIONS.map((l) => (
              <option key={l.city} value={l.city} />
            ))}
          </datalist>
        </label>

        <label className="block text-sm font-medium">
          Business Category
          <input name="category" list="categories" defaultValue="Restaurant" placeholder="e.g. Restaurant" className={field} />
          <datalist id="categories">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <label className="block text-sm font-medium">
          Maximum Results
          <input name="limit" type="number" min={1} max={500} defaultValue={50} className={field} />
        </label>

        <button type="submit" className="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Find Leads
        </button>
      </form>
    </div>
  );
}
