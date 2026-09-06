// Test-process preload only. Never bundled or included in production deploys.
// Enforce the smoke harness's no-egress promise even if a forgotten startup
// worker tries a provider request without credentials.
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

function assertLocal(host) {
  const normalized = String(host || "localhost")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (
    ["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(normalized)
  )
    return;
  const message = "SMOKE_BLOCKED_EXTERNAL: " + normalized;
  console.error(message);
  throw new Error(message);
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === "object") {
    if (first.path)
      throw new Error("SMOKE_BLOCKED_EXTERNAL: socket paths are not permitted");
    assertLocal(first.host || first.hostname);
  } else if (
    typeof first === "number" ||
    (typeof first === "string" && /^\d+$/.test(first))
  ) {
    assertLocal(typeof args[1] === "string" ? args[1] : "localhost");
  } else {
    throw new Error("SMOKE_BLOCKED_EXTERNAL: unrecognized connection target");
  }
  return connect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  assertLocal(url.hostname);
  return originalFetch(input, init);
};
syncBuiltinESMExports();
