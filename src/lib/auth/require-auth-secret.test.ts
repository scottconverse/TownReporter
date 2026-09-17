import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import requireAuthSecret from "../../../server/plugins/require-auth-secret.ts";

/**
 * A real install must refuse to start without a session-signing secret.
 *
 * With none set the app invents one per process. In a preview that is right --
 * the sessions live in a database that dies with the process anyway. On a real
 * install it is a quiet trap: every restart signs the editor out, with no
 * message and no reason, and this product's watchdog restarts the app whenever
 * it looks unwell. The symptom, "it keeps logging me out", points nowhere near
 * the cause, and there is no password reset to fall back on.
 *
 * Measured before this existed: a built server with a real DATABASE_URL and no
 * secret started, served the paper for twenty-five seconds, and never noticed.
 * The check inside the auth module could not help, because that module is only
 * loaded when something asks for auth -- so the failure waited for a sign-in
 * attempt, which the operator meets alone and later.
 */
function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("a real install refuses to start unsigned", () => {
  it("throws when there is a database and no secret", () => {
    withEnv(
      { DATABASE_URL: "postgres://postgres@127.0.0.1:5433/whatever", BETTER_AUTH_SECRET: undefined },
      () => {
        assert.throws(
          () => requireAuthSecret(),
          /BETTER_AUTH_SECRET/,
          "it started an install whose sessions cannot survive a restart",
        );
      },
    );
  });

  it("says how to fix it, not just that it is broken", () => {
    withEnv(
      { DATABASE_URL: "postgres://postgres@127.0.0.1:5433/whatever", BETTER_AUTH_SECRET: undefined },
      () => {
        let message = "";
        try {
          requireAuthSecret();
        } catch {
          /* the operator-facing text goes to stderr; the source carries it */
        }
        message = readFileSync(
          new URL("../../../server/plugins/require-auth-secret.ts", import.meta.url),
          "utf8",
        );
        assert.match(message, /randomBytes/, "it does not show how to generate one");
        assert.match(message, /\.env/, "it does not say where to put it");
      },
    );
  });

  it("lets a real install with a secret through", () => {
    withEnv(
      {
        DATABASE_URL: "postgres://postgres@127.0.0.1:5433/whatever",
        BETTER_AUTH_SECRET: "a-secret-that-outlives-the-process",
      },
      () => {
        assert.doesNotThrow(() => requireAuthSecret());
      },
    );
  });

  it("leaves the zero-config quickstart alone", () => {
    // No DATABASE_URL means the in-memory database, whose sessions die with the
    // process regardless. Demanding a secret there would break the documented
    // five-minute start for no gain.
    withEnv({ DATABASE_URL: undefined, BETTER_AUTH_SECRET: undefined }, () => {
      assert.doesNotThrow(() => requireAuthSecret());
    });
  });
});
