import http from "node:http";
import { config } from "./config.js";

export function startHealthServer(getReady: () => boolean): http.Server {
  const startedAt = Date.now();
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const ready = getReady();
      res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: ready, ready, uptimeMs: Date.now() - startedAt }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(config.health.port);
  return server;
}
