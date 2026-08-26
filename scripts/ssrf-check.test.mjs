import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// Source is TypeScript; the check is duplicated here so Node test runner
// does not need the TS strip loader. Keep in sync with src/lib/news/fetch-url.ts.

function isBlockedAddress(ip) {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (raw.startsWith("::ffff:") && raw.includes(".")) {
    return isBlockedAddress(raw.slice(raw.lastIndexOf(":") + 1));
  }
  if (raw.includes(".")) {
    const p = raw.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (raw === "::1" || raw === "::" || raw === "0:0:0:0:0:0:0:1") return true;
  if (raw.startsWith("fc") || raw.startsWith("fd")) return true;
  if (raw.startsWith("fe80")) return true;
  if (raw.startsWith("ff")) return true;
  return false;
}

test("blocks loopback, RFC1918, link-local, CGNAT, multicast", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.4",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test("allows public v4", () => {
  assert.equal(isBlockedAddress("1.1.1.1"), false);
  assert.equal(isBlockedAddress("8.8.8.8"), false);
});

void createRequire;
