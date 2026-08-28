import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { BlockedAddressError, guardedLookup, resolveFetch } from "./fetch-url.ts";

function lookupOnce(host: string): Promise<{ err: Error | null; address: unknown }> {
  return new Promise((resolve) => {
    void guardedLookup(host, {}, (err, address) =>
      resolve({ err: err ?? null, address }),
    ).catch((err: Error) => resolve({ err, address: null }));
  });
}

describe("guardedLookup", () => {
  it("refuses a hostname that resolves into a private range", async () => {
    const { err } = await lookupOnce("localhost");
    assert.ok(err, "localhost resolves to loopback and must be refused");
    assert.equal(err?.name, "BlockedAddressError");
    assert.match(err!.message, /not fetchable/);
  });

  it("reports the address it refused, so the log says why", async () => {
    const { err } = await lookupOnce("localhost");
    assert.match(err!.message, /127\.0\.0\.1|::1/);
  });

  it("passes a hostname that does not resolve to a private range", async () => {
    const { err, address } = await lookupOnce("example.com");
    // Resolving a real public name needs DNS; skip rather than fail offline.
    if (err && /ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(err.message)) return;
    assert.equal(err, null);
    assert.ok(address);
  });

  it("surfaces a genuine resolution failure as itself, not as a block", async () => {
    const { err } = await lookupOnce("no-such-host.invalid");
    assert.ok(err);
    assert.notEqual(err?.name, "BlockedAddressError");
  });
});

describe("the outbound fetch blocks at connect time", () => {
  let server: Server;
  let port = 0;

  after(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it("reaches a loopback service with plain fetch (proving the target is live)", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("SECRET-INTERNAL-RESPONSE");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;

    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(await res.text(), "SECRET-INTERNAL-RESPONSE");
  });

  it("cannot reach the same service through the guarded fetch", async () => {
    const doFetch = await resolveFetch();
    await assert.rejects(
      // Only the connect-time address check can stop this — the hostname check
      // lives in assertPublicHttpUrl, which this deliberately bypasses.
      doFetch(new URL(`http://localhost:${port}/`), {}),
      (err: unknown) => {
        const chain: string[] = [];
        let e = err as { message?: string; cause?: unknown } | undefined;
        for (let i = 0; e && i < 5; i += 1) {
          if (e.message) chain.push(e.message);
          e = e.cause as typeof e;
        }
        const joined = chain.join(" | ");
        assert.match(joined, /not fetchable|BlockedAddress/i, `unexpected error: ${joined}`);
        return true;
      },
    );
  });
});

describe("BlockedAddressError", () => {
  it("names the address in its message", () => {
    assert.match(new BlockedAddressError("169.254.169.254").message, /169\.254\.169\.254/);
  });
});
