import { buildApp } from "./app.js";
import { pingDb } from "./db.js";

const port = Number(process.env.API_PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const app = await buildApp({ pingDb, webOrigin });
await app.listen({ port, host: "127.0.0.1" });
console.log(`LeadHunter API listening on http://127.0.0.1:${port}`);
