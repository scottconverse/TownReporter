import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { startGuardedRenderProxy } from "./render-proxy.ts";

/**
 * ENG-201 regression pin for the render path.
 *
 * The Playwright render path used to resolve a host, check it, then let
 * Chromium resolve it AGAIN and connect — a DNS-rebinding window on an
 * unattended, model-extracted URL. The fix routes Chromium through a loopback
 * proxy that resolves each host once via the shared `guardedLookup` and dials
 * that vetted address; a blocked address is refused before a socket opens.
 *
 * This test speaks the proxy's own protocol (an HTTP CONNECT, exactly what
 * Chromium sends for an https target) and asserts a private/loopback authority
 * is refused with 403 rather than tunneled. If a future change lets the render
 * path reach a private address again, this fails. The `undici` path has the
 * matching proof in ssrf-agent.test.ts; before this, the render path had none.
 */

/** Send one CONNECT through the proxy and return the status line it answers. */
function connectThrough(port: number, authority: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const line = buf.split("\r\n", 1)[0] ?? "";
      if (line) {
        sock.destroy();
        resolve(line);
      }
    });
    sock.on("error", reject);
    sock.setTimeout(5000, () => {
      sock.destroy();
      reject(new Error("proxy did not answer"));
    });
  });
}

test("the render proxy refuses a loopback/private CONNECT target", async () => {
  const proxy = await startGuardedRenderProxy();
  assert.ok(proxy, "proxy should start on a server");

  // 127.0.0.1 is a blocked address literal; the proxy must not tunnel to it.
  const loopback = await connectThrough(proxy.port, "127.0.0.1:80");
  assert.match(loopback, /403/, `loopback target must be refused, got: ${loopback}`);

  // A hostname that resolves to loopback is the rebinding shape — also refused.
  const named = await connectThrough(proxy.port, "localhost:80");
  assert.match(named, /403/, `localhost target must be refused, got: ${named}`);
});
