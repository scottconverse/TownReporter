import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAccountLockout, normalizeAccountKey } from "./account-lockout.server.ts";

/**
 * Fast, no-database unit tests of the pure per-account throttle algorithm --
 * `account-lockout.server.test.ts`'s sibling in `sign-in-throttle.test.ts`
 * (Postgres-backed, opt-in) proves this is actually wired into the real
 * server's `/api/auth/sign-in/email`; this file proves the algorithm itself
 * does what the design in `account-lockout.server.ts` claims, one property
 * at a time and fast enough to run on every `npm test`.
 *
 * A fake clock (not real timers) makes the window-expiry and non-extension
 * properties checkable without the test actually waiting real seconds.
 */

function fakeClock(startMs = 0) {
  let now = startMs;
  return {
    clock: () => now,
    advanceSeconds: (s: number) => {
      now += s * 1000;
    },
  };
}

describe("normalizeAccountKey", () => {
  it("folds case and surrounding whitespace so the same account shares one bucket", () => {
    assert.equal(normalizeAccountKey("Editor@Example.com"), "editor@example.com");
    assert.equal(normalizeAccountKey("  editor@example.com  "), "editor@example.com");
  });
});

describe("createAccountLockout", () => {
  it("lets attempts through until maxAttempts wrong passwords have been recorded", () => {
    const { clock } = fakeClock();
    const lockout = createAccountLockout({ maxAttempts: 3, windowSeconds: 900, clock });
    const email = "editor@example.com";

    for (let i = 0; i < 3; i += 1) {
      assert.equal(
        lockout.check(email).blocked,
        false,
        `attempt ${i + 1} of 3 should not be blocked yet`,
      );
      lockout.recordFailure(email);
    }

    const decision = lockout.check(email);
    assert.equal(decision.blocked, true, "a 4th attempt after 3 failures must be blocked");
    if (decision.blocked) {
      assert.ok(decision.retryAfterSeconds > 0, "a blocked decision must report a positive retry-after");
    }
  });

  it("is keyed by account, not by any caller-supplied value -- a different email has its own budget", () => {
    const { clock } = fakeClock();
    const lockout = createAccountLockout({ maxAttempts: 2, windowSeconds: 900, clock });
    lockout.recordFailure("victim@example.com");
    lockout.recordFailure("victim@example.com");
    assert.equal(lockout.check("victim@example.com").blocked, true);
    assert.equal(
      lockout.check("someone-else@example.com").blocked,
      false,
      "locking one account must not affect another account's budget",
    );
  });

  it("clears the lock immediately on a recorded success", () => {
    const { clock } = fakeClock();
    const lockout = createAccountLockout({ maxAttempts: 2, windowSeconds: 900, clock });
    const email = "editor@example.com";
    lockout.recordFailure(email);
    lockout.recordFailure(email);
    assert.equal(lockout.check(email).blocked, true);
    lockout.recordSuccess(email);
    assert.equal(
      lockout.check(email).blocked,
      false,
      "the correct password succeeding must clear the account's lock immediately",
    );
  });

  it("self-clears windowSeconds after the failure that tripped it, with no action required", () => {
    const { clock, advanceSeconds } = fakeClock();
    const lockout = createAccountLockout({ maxAttempts: 2, windowSeconds: 10, clock });
    const email = "editor@example.com";
    lockout.recordFailure(email);
    lockout.recordFailure(email);
    assert.equal(lockout.check(email).blocked, true);

    advanceSeconds(9);
    assert.equal(lockout.check(email).blocked, true, "still inside the 10s window");

    advanceSeconds(2); // total 11s since the tripping failure
    assert.equal(
      lockout.check(email).blocked,
      false,
      "the lock must lift on its own once windowSeconds has passed -- nobody has to intervene",
    );
  });

  it(
    "an attacker who keeps knocking on an already-tripped lock cannot hold it open past windowSeconds",
    () => {
      const { clock, advanceSeconds } = fakeClock();
      const lockout = createAccountLockout({ maxAttempts: 2, windowSeconds: 10, clock });
      const email = "editor@example.com";
      lockout.recordFailure(email);
      lockout.recordFailure(email);
      assert.equal(lockout.check(email).blocked, true);

      // `server.ts`'s `before` hook calls exactly `check()` on a blocked
      // request and never reaches `recordFailure` -- it throws first (see
      // `accountSignInLockout`). Simulating that discipline here (many
      // `check()` calls, no `recordFailure`) is what a continuous attack
      // against an already-locked account actually looks like on the wire.
      for (let i = 0; i < 50; i += 1) {
        advanceSeconds(0.1);
        assert.equal(lockout.check(email).blocked, true, `still locked at ${i} continued knocks`);
      }
      // 5s of continuous knocking elapsed; the lock is still anchored to the
      // ORIGINAL tripping failure, so it expires on schedule regardless of
      // how much the attacker bangs on it in the meantime.
      advanceSeconds(6); // total 11s since the tripping failure
      assert.equal(
        lockout.check(email).blocked,
        false,
        "continued knocking against a blocked account must not push the unlock time out -- " +
          "otherwise a patient attacker could hold the lock open forever, which is a worse " +
          "outcome than the header-rotation bug this file exists to close",
      );
    },
  );

  it("treats a fresh window as a clean slate: one prior failure long ago does not count toward a new lock", () => {
    const { clock, advanceSeconds } = fakeClock();
    const lockout = createAccountLockout({ maxAttempts: 2, windowSeconds: 10, clock });
    const email = "editor@example.com";
    lockout.recordFailure(email);
    advanceSeconds(20); // window lapsed with only 1 failure recorded
    assert.equal(lockout.check(email).blocked, false);
    lockout.recordFailure(email);
    assert.equal(
      lockout.check(email).blocked,
      false,
      "1 failure in the new window is below maxAttempts=2",
    );
  });
});
