import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertHttpUrl,
  fetchPublicHttp,
  isBlockedAddress,
  setFetchImplForTests,
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

  /*
    Ranges that reach a private address through a literal the filter has to
    read past. Each case is a pair: an address inside the range that resolves
    to something private (blocked), and one inside the same range that reaches
    a public host (allowed). The pairs matter -- a range blocked wholesale
    would pass the first half of every one of these and break the second.
  */
  it("blocks 198.18.0.0/15 (benchmarking) and allows the addresses either side", () => {
    for (const ip of ["198.18.0.1", "198.18.255.255", "198.19.0.1", "198.19.255.255"]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    assert.equal(isBlockedAddress("198.17.255.255"), false);
    assert.equal(isBlockedAddress("198.20.0.1"), false);
  });

  it("blocks 192.0.0.0/24 (IETF protocol assignments) and allows its neighbours", () => {
    for (const ip of ["192.0.0.0", "192.0.0.1", "192.0.0.170", "192.0.0.255"]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    assert.equal(isBlockedAddress("192.0.1.1"), false);
    assert.equal(isBlockedAddress("192.0.255.255"), false);
  });

  it("blocks the NAT64 well-known prefix 64:ff9b::/96 by the IPv4 it embeds", () => {
    for (const ip of [
      "64:ff9b::127.0.0.1",
      "64:ff9b::7f00:1",
      "64:ff9b::10.0.0.1",
      "64:ff9b::a00:1",
      "64:ff9b::169.254.169.254",
      "64:ff9b::a9fe:a9fe",
      "64:ff9b::192.168.1.1",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    assert.equal(isBlockedAddress("64:ff9b::808:808"), false);
    assert.equal(isBlockedAddress("64:ff9b::6812:2001"), false);
  });

  it("refuses an IPv6 literal with a dotted IPv4 tail, whatever address it carries", () => {
    // Not a range rule: a literal mixing ':' and '.' is not something a
    // resolver returns, so it is refused outright rather than judged. That was
    // the behaviour before these ranges were added, and it is kept.
    for (const ip of [
      "64:ff9b::8.8.8.8",
      "64:ff9b::127.0.0.1",
      "2002:808:808::1.2.3.4",
      "64:ff9b:1:808:8:800::9.9.9.9",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });

  it("blocks the local-use NAT64 prefix 64:ff9b:1::/48 by the IPv4 it embeds", () => {
    // RFC 6052's /48 layout: the first two octets occupy the fourth hextet,
    // the third and fourth follow after a zero octet, so 10.1.2.3 is
    // `64:ff9b:1:a01:2:300::`. The IPv4 is not in the last 32 bits here.
    for (const ip of [
      "64:ff9b:1:a01:2:300::",
      "64:ff9b:1:7f00:0:100::",
      "64:ff9b:1:c0a8:1:100::",
      "64:ff9b:1::7f00:1",
      "64:ff9b:1::a00:1",
      "64:ff9b:1:a9fe:a9fe::",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    // A translation to a public host must still be fetchable.
    assert.equal(isBlockedAddress("64:ff9b:1:808:8:800::"), false);
    assert.equal(isBlockedAddress("64:ff9b:1:6812:20:100::"), false);
  });

  it("blocks 6to4 2002::/16 by the IPv4 in its first two hextets", () => {
    for (const ip of [
      "2002:7f00:1::",
      "2002:7f00:1::1",
      "2002:a00:1::",
      "2002:c0a8:101::",
      "2002:a9fe:a9fe::",
      "2002:ac10:1::",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    assert.equal(isBlockedAddress("2002:808:808::"), false);
    assert.equal(isBlockedAddress("2002:6818:201::"), false);
  });

  it("blocks IPv4-mapped ::ffff:0:0/96 by the IPv4 it carries", () => {
    for (const ip of [
      "::ffff:0:0",
      "::ffff:0.0.0.0",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:192.0.0.1",
      "::ffff:198.18.0.1",
      "0:0:0:0:0:ffff:198.18.0.1",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    assert.equal(isBlockedAddress("::ffff:1.1.1.1"), false);
    assert.equal(isBlockedAddress("::ffff:198.20.0.1"), false);
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
    const original = null;
    const fetched: string[] = [];
    setFetchImplForTests((async (input: RequestInfo | URL) => {
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
    }) as unknown as import("./fetch-url.ts").FetchLike);
    try {
      await assert.rejects(
        () => fetchPublicHttp(new URL("http://1.1.1.1/page")),
        /not fetchable/,
      );
      assert.equal(fetched.length, 1);
      assert.match(fetched[0]!, /^http:\/\/1\.1\.1\.1/);
    } finally {
      setFetchImplForTests(original);
    }
  });

  it("follows a same-origin public redirect", async () => {
    const original = null;
    setFetchImplForTests((async (input: RequestInfo | URL) => {
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
    }) as unknown as import("./fetch-url.ts").FetchLike);
    try {
      const res = await fetchPublicHttp(new URL("http://1.1.1.1/from"));
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "ok");
    } finally {
      setFetchImplForTests(original);
    }
  });
});
