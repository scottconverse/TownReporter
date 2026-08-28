import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertHttpUrl,
  fetchPublicHttp,
  isBlockedAddress,
} from "./fetch-url.ts";

describe("isBlockedAddress", () => {
  it("blocks loopback, RFC1918, link-local, CGNAT, multicast, ULA", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.4",
      "192.168.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.169.254",
      "100.64.0.1",
      "100.127.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.1.2.3",
      "::ffff:7f00:1",
      "::ffff:a9fe:a9fa",
      "::ffff:a9fe:a9fe",
      "::ffff:a00:1",
      "0:0:0:0:0:ffff:7f00:1",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });

  it("allows public v4 and public IPv4-mapped v6", () => {
    assert.equal(isBlockedAddress("1.1.1.1"), false);
    assert.equal(isBlockedAddress("8.8.8.8"), false);
    assert.equal(isBlockedAddress("104.18.32.1"), false);
    assert.equal(isBlockedAddress("::ffff:808:808"), false);
    assert.equal(isBlockedAddress("::ffff:8.8.8.8"), false);
  });
});

describe("assertHttpUrl", () => {
  it("rejects non-http schemes", () => {
    assert.throws(() => assertHttpUrl("file:///etc/passwd"), /Only http/);
    assert.throws(() => assertHttpUrl("javascript:alert(1)"), /Only http|Invalid URL/);
    assert.throws(() => assertHttpUrl("ftp://example.com/"), /Only http/);
  });

  it("rejects localhost and internal names", () => {
    assert.throws(() => assertHttpUrl("http://localhost/"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://foo.internal/"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://metadata.google.internal/"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://printer.local/"), /not fetchable/);
  });

  it("rejects blocked IP literals before fetch", () => {
    assert.throws(() => assertHttpUrl("http://127.0.0.1/"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://169.254.169.254/latest/meta-data/"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://[::1]/"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://10.0.0.5/admin"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://[::ffff:7f00:1]/"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://[::ffff:a9fe:a9fa]/latest/meta-data/"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data/"), /not fetchable/);
    assert.throws(() => assertHttpUrl("http://[::ffff:127.0.0.1]/"), /not fetchable/);
  });

  it("accepts public https civic hosts", () => {
    const u = assertHttpUrl("https://www.longmontcolorado.gov/government/city-council");
    assert.equal(u.hostname, "www.longmontcolorado.gov");
  });
});

describe("fetchPublicHttp redirect SSRF", () => {
  it("re-validates each hop and refuses a redirect onto loopback", async () => {
    const original = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      fetched.push(url);
      if (url.startsWith("http://1.1.1.1")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/latest/meta-data/" },
        });
      }
      return new Response("should-not-fetch-blocked-host", { status: 200 });
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => fetchPublicHttp(new URL("http://1.1.1.1/page")),
        /not fetchable/,
      );
      assert.equal(fetched.length, 1);
      assert.match(fetched[0]!, /^http:\/\/1\.1\.1\.1/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("follows a same-origin public redirect", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === "http://1.1.1.1/from") {
        return new Response(null, {
          status: 301,
          headers: { location: "http://1.1.1.1/to" },
        });
      }
      if (url === "http://1.1.1.1/to") {
        return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response("unexpected " + url, { status: 500 });
    }) as typeof fetch;
    try {
      const res = await fetchPublicHttp(new URL("http://1.1.1.1/from"));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "ok");
    } finally {
      globalThis.fetch = original;
    }
  });
});
