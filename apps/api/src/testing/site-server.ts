import http from "node:http";
import type { AddressInfo } from "node:net";

export type SiteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

export interface TestSite {
  /** e.g. http://127.0.0.1:41234 */
  origin: string;
  /** "127.0.0.1:41234" for UrlGuard testAllowList */
  hostPort: string;
  hits: string[];
  close(): Promise<void>;
}

/** Tiny local HTTP server used only by tests. `routes` maps request paths to handlers. */
export async function startTestSite(routes: Record<string, SiteHandler | string>): Promise<TestSite> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    hits.push(`${req.method} ${path}`);
    const route = routes[path];
    if (route === undefined) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<h1>Not found</h1>");
    }
    if (typeof route === "string") {
      res.writeHead(200, { "content-type": path.endsWith(".txt") ? "text/plain" : path.endsWith(".xml") ? "application/xml" : "text/html; charset=utf-8" });
      return res.end(route);
    }
    route(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    hostPort: `127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export const redirectTo =
  (location: string, status = 302): SiteHandler =>
  (_req, res) => {
    res.writeHead(status, { location });
    res.end();
  };
