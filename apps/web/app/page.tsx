import { healthResponseSchema } from "@leadhunter/shared";

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

export default async function Home() {
  const health = await getHealth();
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold">LeadHunter</h1>
      <p className="mt-2 text-zinc-600">Local business lead research dashboard.</p>
      <section className="mt-8 rounded-lg border p-4" data-testid="health-card">
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
    </main>
  );
}
