import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { test } from "node:test";
import { startPostgresStartupServer } from "../scripts/postgres-startup-server.mjs";

const options = { environment: {}, entry: "dist/index-web.mjs", listenPort: 0, listenHost: "127.0.0.1" };

async function request(port: number, pathname: string, method = "GET") {
  return new Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const connection = http.request({ host: "127.0.0.1", port, path: pathname, method, agent: false }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    connection.once("error", reject);
    connection.end();
  });
}

test("startup HTTP distinguishes process liveness from readiness and never caches maintenance responses", async () => {
  const server = await startPostgresStartupServer(options);
  try {
    for (const [pathname, expected] of [["/healthz", 200], ["/readyz", 503], ["/api/stations", 503], ["/app.js", 503]] as const) {
      const response = await request(server.port, pathname);
      assert.equal(response.status, expected);
      assert.deepEqual(JSON.parse(response.body), { status: "initializing", ready: false });
      assert.match(response.headers["cache-control"]!, /no-store/);
      assert.equal(response.headers["retry-after"], "5");
      assert.match(response.headers["x-robots-tag"] as string, /noindex/);
      assert.equal(response.headers.connection, "close");
    }
    assert.equal(server.failureSignal.aborted, false);
  } finally {
    await server.close();
  }
});

test("web GET maintenance refreshes automatically without reflecting URLs, headers, or secrets", async () => {
  const secret = "unique-private-postgres-password";
  const server = await startPostgresStartupServer({ ...options, environment: { DATABASE_URL: `postgresql://user:${secret}@host/db` } });
  try {
    const response = await request(server.port, "/en?token=secret-query-value");
    assert.equal(response.status, 503);
    assert.match(response.headers["content-type"]!, /text\/html/);
    assert.match(response.body, /http-equiv="refresh" content="10"/);
    assert.match(response.body, /after the data import has been verified/);
    assert.doesNotMatch(response.body, /secret-query-value|unique-private-postgres-password|postgresql:\/\//);
    assert.equal((await request(server.port, "/en", "HEAD")).body, "");
    assert.equal((await request(server.port, "/healthz", "HEAD")).status, 200);
  } finally {
    await server.close();
  }
});

test("all API routes and mutating methods stay unavailable instead of reaching application handlers", async () => {
  for (const entry of ["dist/index-web.mjs", "dist/index-api.mjs", "dist/index.mjs"]) {
    const server = await startPostgresStartupServer({ ...options, entry });
    try {
      for (const [pathname, method] of [["/healthz", "POST"], ["/readyz", "DELETE"], ["/login", "POST"], ["/api", "GET"], ["/api/auth", "OPTIONS"]]) {
        const response = await request(server.port, pathname, method);
        assert.equal(response.status, 503);
        assert.match(response.headers["content-type"]!, /application\/json/);
        assert.equal(JSON.parse(response.body).ready, false);
      }
      if (entry === "dist/index-api.mjs") {
        assert.match((await request(server.port, "/")).headers["content-type"]!, /application\/json/);
      }
    } finally {
      await server.close();
    }
  }
});

test("closing the startup listener is idempotent and releases the exact port for automatic application handoff", async () => {
  const server = await startPostgresStartupServer(options);
  await request(server.port, "/healthz");
  await Promise.all([server.close(), server.close()]);
  const application = http.createServer((_request, response) => response.end("actual application"));
  try {
    application.listen(server.port, "127.0.0.1");
    await once(application, "listening");
    assert.equal((await request(server.port, "/")).body, "actual application");
    assert.equal(server.failureSignal.aborted, false);
  } finally {
    await new Promise<void>((resolve) => application.close(() => resolve()));
  }
});

test("shutdown bounds open incomplete-request sockets so a client cannot block application startup", async () => {
  const server = await startPostgresStartupServer(options);
  const socket = net.connect(server.port, "127.0.0.1");
  socket.on("error", () => {});
  await once(socket, "connect");
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
  try {
    await Promise.race([
      server.close(),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("shutdown was not bounded")), 3_000); timer.unref(); }),
    ]);
  } finally {
    socket.destroy();
    await server.close();
  }
});

test("invalid service ports and unknown application entries fail before opening a listener", async () => {
  for (const PORT of ["", " ", "0", "-1", "1.5", "65536", "Infinity", "NaN", "5000-secret"]) {
    await assert.rejects(startPostgresStartupServer({ ...options, environment: { PORT } }), /PORT must be an integer/);
  }
  await assert.rejects(startPostgresStartupServer({ ...options, entry: "../../unexpected.mjs" }), /known application entry/);
  await assert.rejects(startPostgresStartupServer({ ...options, listenPort: -1 }), /listen port/);
  await assert.rejects(startPostgresStartupServer({ ...options, listenPort: 1.5 }), /listen port/);
});

test("binding an occupied port fails with a sanitized error and does not interfere with the existing listener", async () => {
  const server = await startPostgresStartupServer(options);
  try {
    await assert.rejects(startPostgresStartupServer({ ...options, listenPort: server.port }), {
      code: "POSTGRES_STARTUP_SERVER_BIND_FAILED",
      message: "PostgreSQL startup HTTP listener could not bind the configured port",
    });
    assert.equal((await request(server.port, "/healthz")).status, 200);
  } finally {
    await server.close();
  }
});

test("post-listen server errors abort the failure signal without leaking details or throwing an unhandled event", async (context) => {
  const createServer = http.createServer;
  let actualServer: http.Server | undefined;
  context.mock.method(http, "createServer", (...args: Parameters<typeof createServer>) => {
    actualServer = createServer(...args);
    return actualServer;
  });
  const server = await startPostgresStartupServer(options);
  try {
    actualServer!.emit("error", new Error("sensitive socket information password=private-value"));
    assert.equal(server.failureSignal.aborted, true);
    assert.equal(server.failureSignal.reason.code, "POSTGRES_STARTUP_SERVER_FAILED");
    assert.equal(server.failureSignal.reason.message, "PostgreSQL startup HTTP listener failed");
    assert.doesNotMatch(server.failureSignal.reason.message, /sensitive|private-value/);
  } finally {
    await server.close();
  }
});
