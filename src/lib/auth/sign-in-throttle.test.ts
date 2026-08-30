import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Password guessing must be throttled, and must not be throttled by NODE_ENV.
 *
 * An audit sent eighty wrong passwords in 6.3 seconds against a built server
 * and got eighty 401s -- no delay, no lockout. Better Auth ships the rule that
 * would have stopped it, but `rateLimit.enabled` defaults to `isProduction`,
 * and this app is started by a Windows scheduled task running
 * `node .output/server/index.mjs`, which sets no NODE_ENV. The protection
 * existed and was off on the one deployment exposed to the internet.
 *
 * Measured after the fix, against a running built server:
 *   fresh attacker IP:  401 x10, then 429 for every attempt after
 *   honest operator IP: 200 on the first try, during the attack
 *
 * That second line is the one people forget. The limiter buckets by client IP,
 * so an attacker exhausts their own budget. Behind a Cloudflare Tunnel every
 * request arrives from 127.0.0.1, and without an IP header to read the limiter
 * files the whole internet under one key -- at which point ten guesses from a
 * stranger lock the journalist out of their own desk and the fix becomes the
 * outage. Hence the header configuration, asserted here alongside the limit.
 */
const src = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

describe("sign-in is throttled", () => {
  it("turns rate limiting on rather than inheriting the environment default", () => {
    /*
      Anchored to `rateLimit: {` itself, not to a window of characters after it.

      The first version of this assertion read 600 characters from the block and
      searched them for `enabled: true`. It passed with `rateLimit.enabled` set
      to FALSE, because `emailAndPassword: { enabled: true }` sits inside that
      window. A gate that cannot fail is worse than no gate; this one was caught
      by mutating the flag and watching it stay green.
    */
    assert.match(
      src,
      /rateLimit:\s*\{\s*enabled:\s*true/,
      "rateLimit.enabled defaults to isProduction, and this app starts with no NODE_ENV; " +
        "it must be set to true immediately inside the rateLimit block",
    );
  });

  it("keeps a slow-guessing rule on the sign-in path", () => {
    const at = src.indexOf("customRules");
    assert.ok(at > 0, "no customRules block");
    const rules = src.slice(at, at + 400);
    assert.match(rules, /"\/sign-in\/email":/, "no custom rule for the sign-in path");
    const m = rules.match(/"\/sign-in\/email":\s*\{\s*window:\s*(\d+),\s*max:\s*(\d+)/);
    assert.ok(m, `could not read the sign-in rule from: ${rules.slice(0, 200)}`);
    const [, window, max] = m;
    assert.ok(
      Number(window) >= 60,
      `a ${window}s window only stops a burst; the patient attack is the one that works ` +
        `against a single known account`,
    );
    assert.ok(
      Number(max) <= 20,
      `${max} attempts per window is too many for a desk with one account and no password reset`,
    );
  });

  it("reads the visitor's real address, so an attacker cannot lock out the operator", () => {
    assert.match(
      src,
      /ipAddressHeaders:\s*\[[^\]]*"cf-connecting-ip"/,
      "behind the tunnel every request comes from 127.0.0.1; without a header to read, " +
        "the limiter files the whole internet under one key and the throttle becomes a lockout",
    );
  });
});
