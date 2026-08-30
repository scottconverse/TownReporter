import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The documented first install must not answer on the local network.
 *
 * Node binds every interface when HOST is unset, and the README tells a new
 * operator to `cp .env.example .env`. With HOST commented out, that documented
 * path produced a paper -- and a desk, and a Server page that can restart
 * services on the machine -- reachable from any other address on the LAN. A
 * gate audit booted it that way and reached /desk/ops from 192.168.0.135.
 *
 * It compounds. Sign-in throttling buckets by the visitor's address, taken from
 * `cf-connecting-ip`. Cloudflare sets that at its edge, so a visitor through the
 * tunnel cannot forge it; anything reaching the port directly can. Measured
 * here: 25 wrong passwords from one address gives 10 refusals then blocking,
 * while the same 25 with a rotating header gets 24 through. Loopback is what
 * keeps that path shut, which is why it is a default rather than advice.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Read a variable that is actually SET -- a commented line does not count. */
function setValue(text, name) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim();
  }
  return null;
}

test(".env.example binds the built server to loopback", () => {
  const text = readFileSync(join(ROOT, ".env.example"), "utf8");
  const host = setValue(text, "HOST");
  assert.ok(
    host,
    "HOST is not set in .env.example, so `cp .env.example .env` binds every " +
      "interface and the desk answers on the local network",
  );
  assert.ok(
    host === "127.0.0.1" || host === "localhost" || host === "::1",
    `HOST is "${host}"; the documented install must bind loopback, not a routable address`,
  );
});

test("the reason is written down where someone about to change it will read it", () => {
  // A bare `HOST=127.0.0.1` invites deletion by anyone who wants LAN access and
  // does not know what else it is holding up.
  const text = readFileSync(join(ROOT, ".env.example"), "utf8");
  const idx = text.indexOf("\nHOST=");
  assert.ok(idx > 0, "HOST is not set");
  const preamble = text.slice(Math.max(0, idx - 1600), idx);
  assert.match(
    preamble,
    /throttl|cf-connecting-ip|local network|LAN/i,
    "nothing above HOST explains what binding to loopback is protecting",
  );
});
