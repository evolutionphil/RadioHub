import http from "node:http";

const entries = new Set(["dist/index-api.mjs", "dist/index-web.mjs", "dist/index.mjs"]);
const pending = JSON.stringify({ status: "initializing", ready: false });
const maintenancePage = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta http-equiv=\"refresh\" content=\"10\"><meta name=\"robots\" content=\"noindex\"><title>Temporarily unavailable</title></head><body><h1>Database initialization in progress</h1><p>The service will open automatically after the data import has been verified. This page refreshes automatically.</p></body></html>";

function applicationPort(environment, entry) {
  if (!entries.has(entry)) throw new Error("PostgreSQL startup server requires a known application entry");
  if (environment.PORT === undefined) return entry === "dist/index-web.mjs" ? 3000 : 5000;
  const value = String(environment.PORT);
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

/** Keep process liveness separate from application readiness while no application code is loaded. */
export async function startPostgresStartupServer({
  environment = process.env,
  entry,
  // An ephemeral port and loopback host are injectable for isolated local HTTP tests.
  listenPort,
  listenHost = "0.0.0.0",
} = {}) {
  const configuredPort = applicationPort(environment, entry);
  const port = listenPort === undefined ? configuredPort : listenPort;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error("Startup server listen port must be an integer between 0 and 65535");
  }
  const failure = new AbortController();
  const sockets = new Set();
  let listening = false;
  let closing = false;
  let closePromise;
  const server = http.createServer((request, response) => {
    const readRequest = request.method === "GET" || request.method === "HEAD";
    let pathname;
    try {
      pathname = new URL(request.url || "/", "http://localhost").pathname;
    } catch {
      pathname = "/";
    }
    const alive = readRequest && pathname === "/healthz";
    const html = !alive && readRequest && entry !== "dist/index-api.mjs"
      && pathname !== "/readyz" && pathname !== "/api" && !pathname.startsWith("/api/")
      && !/\.[^/]+$/.test(pathname);
    const body = html ? maintenancePage : pending;
    response.writeHead(alive ? 200 : 503, {
      "Content-Type": html ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store, max-age=0",
      "Retry-After": "5",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      Connection: "close",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  server.maxConnections = 128;
  server.maxHeadersCount = 100;
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.setTimeout(10_000, (socket) => socket.destroy());
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  // Never surface request data or connection details in a startup failure.
  server.on("error", () => {
    if (listening && !closing) {
      const error = new Error("PostgreSQL startup HTTP listener failed");
      error.code = "POSTGRES_STARTUP_SERVER_FAILED";
      failure.abort(error);
    }
  });
  await new Promise((resolve, reject) => {
    const onError = () => {
      const error = new Error("PostgreSQL startup HTTP listener could not bind the configured port");
      error.code = "POSTGRES_STARTUP_SERVER_BIND_FAILED";
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, listenHost, () => {
      server.off("error", onError);
      listening = true;
      resolve();
    });
  });
  const address = server.address();

  return {
    port: typeof address === "object" && address ? address.port : port,
    failureSignal: failure.signal,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = new Promise((resolve) => {
        const forceClose = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
        }, 1_000);
        const finished = () => {
          clearTimeout(forceClose);
          listening = false;
          resolve();
        };
        // Stop accepting requests before draining/destroying sockets so the real app can rebind.
        try {
          server.close(finished);
          server.closeIdleConnections();
        } catch {
          for (const socket of sockets) socket.destroy();
          finished();
        }
      });
      return closePromise;
    },
  };
}
