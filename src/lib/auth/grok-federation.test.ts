import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  ensureBuilt,
  spawnBuiltServer,
  waitForServer,
  type ChildProcess,
} from "../test-support/pg-admin.ts";
import {
  authEnforced,
  grokFederation,
  grokFederationWarning,
  GROK_PREVIEW_OPT_IN,
} from "./grok-federation.ts";

/**
 * Sign-in does not federate to the Grok broker unless the operator asked it to.
 *
 * This replaces a fallback. `server.ts` read
 *
 *   const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? PREVIEW_CLIENT_ID;
 *   const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET") ?? PREVIEW_CLIENT_SECRET;
 *
 * and `PREVIEW_CLIENT_SECRET` is a literal in this repository. So on every
 * self-hosted install -- the ones that set no `GROK_AUTH_*` at all, which is all
 * of them -- the shared preview client was registered as a live OAuth provider.
 * Measured on a built server started with NO Grok variable, before the fix:
 *
 *   POST /api/auth/sign-in/oauth2 {"providerId":"grok-google"}
 *   -> 200 {"url":"https://auth.grok.me/api/auth/oauth2/authorize?idp=google&
 *           prompt=login&client_id=grok_preview&…"}
 *
 * An editor on a paper that never asked for federation was one click from
 * signing in through a third party's broker. The lower half of this file is
 * that request, against a real compiled server, in both states.
 *
 * WHY THE WIRE AND NOT THE SOURCE: a grep for `PREVIEW_CLIENT_SECRET` finds it
 * whether or not it is reachable, and the module that used to hold the bug
 * cannot be imported here at all -- `server.ts` pulls in `pg` and
 * `pglite-dialect.ts`, which uses TypeScript parameter properties that Node's
 * `--experimental-strip-types` rejects (see sign-in-throttle.test.ts:34-37).
 * Booting the build and reading the response is the only route, and it is also
 * the honest one: the defect was in what the server DID.
 *
 * No Postgres is needed -- the built server runs on its embedded PGlite with an
 * empty `DATABASE_URL` -- so unlike the throttle tests this file does not skip.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** A server with no Grok configuration of any kind. */
const PORT_PLAIN = 3862;
/** The same build, the sandbox preview's explicit opt-in. */
const PORT_PREVIEW = 3863;

/**
 * Every Grok variable, explicitly emptied.
 *
 * `spawnBuiltServer` spreads the parent environment, and the answer this file
 * reports on must not depend on whether the machine running the tests happens
 * to have `GROK_AUTH_CLIENT_ID` exported. An empty string is "unset" to
 * `grokFederation` (it trims), so this pins the question rather than hoping.
 */
const NO_GROK_ENV: NodeJS.ProcessEnv = {
  GROK_AUTH_CLIENT_ID: "",
  GROK_AUTH_CLIENT_SECRET: "",
  GROK_AUTH_ISSUER: "",
  [GROK_PREVIEW_OPT_IN]: "",
};

function post(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          // sign-up/sign-in go through Better Auth's CSRF origin check, which
          // rejects a request that carries no Origin at all. node:http rather
          // than fetch() because undici always sends `Sec-Fetch-Mode: cors`,
          // which the same middleware reads as a browser request and then
          // demands an Origin for -- a 403 that says nothing about the provider
          // question this file is asking.
          origin: base,
          // No keep-alive pool. Node's global agent holds its sockets open, and
          // a socket to a server this file is about to kill is a handle the test
          // runner waits on before it will exit.
          connection: "close",
        },
        agent: false,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** Start one registered provider's flow. The response is the answer. */
const startGrokSignIn = (base: string) =>
  post(base, "/api/auth/sign-in/oauth2", { providerId: "grok-google", callbackURL: "/desk" });

describe("the broker client is a decision, and it is made here", () => {
  it("auth is enforced when nothing about Grok is configured", () => {
    // The old expression ANDed in `Boolean(grokClientId && grokClientSecret)`.
    // Those were never false only because both fell back to baked constants, so
    // the conjunction read as a rule and was really decoration -- and the
    // sentence it told was that a paper with no broker client has no auth.
    assert.equal(authEnforced({}), true);
    assert.equal(authEnforced({ GROK_AUTH_CLIENT_ID: "" }), true);
    assert.equal(authEnforced({ VITE_AUTH_ENABLED: "true" }), true);
    // The one and only off-switch.
    assert.equal(authEnforced({ VITE_AUTH_ENABLED: "false" }), false);
  });

  it("registers no provider at all when nothing is configured", () => {
    // Not "registers one whose id is empty": with the preview callback not even
    // consulted, there is no client to register.
    let asked = false;
    const resolved = grokFederation({}, () => {
      asked = true;
      return { clientId: "grok_preview", clientSecret: "committed-literal" };
    });
    assert.equal(resolved, null);
    assert.equal(asked, false, "the preview client must not even be read without the opt-in");
  });

  it("uses the preview client only under the explicit opt-in, and names it as preview", () => {
    const resolved = grokFederation({ [GROK_PREVIEW_OPT_IN]: "1" }, () => ({
      clientId: "grok_preview",
      clientSecret: "committed-literal",
    }));
    assert.equal(resolved?.clientId, "grok_preview");
    assert.equal(resolved?.from, "preview");
  });

  it("prefers an explicit client, and treats half a client as none", () => {
    const explicit = grokFederation({
      GROK_AUTH_CLIENT_ID: "own-id",
      GROK_AUTH_CLIENT_SECRET: "own-secret",
      // Even the sandbox flag must not override a real client.
      [GROK_PREVIEW_OPT_IN]: "1",
    });
    assert.equal(explicit?.clientId, "own-id");
    assert.equal(explicit?.from, "explicit");

    // Half a client registers nothing: putting the broker in the sign-in list
    // and failing at the callback is a worse way to learn a variable is missing.
    assert.equal(grokFederation({ GROK_AUTH_CLIENT_ID: "own-id" }), null);
    assert.equal(grokFederation({ GROK_AUTH_CLIENT_SECRET: "own-secret" }), null);
    // ...and says so, since a half-set variable means the operator believes it
    // is on.
    assert.match(String(grokFederationWarning({ GROK_AUTH_CLIENT_ID: "own-id" })), /GROK_AUTH_CLIENT_SECRET/);
    assert.equal(grokFederationWarning({}), null);
  });
});

describe("the built server neither federates nor loses email sign-in", () => {
  let server: ChildProcess | undefined;

  after(() => {
    server?.kill();
  }, { timeout: 30_000 });

  it("with no Grok environment at all: no broker flow, and password sign-up still works", async () => {
    const base = `http://127.0.0.1:${PORT_PLAIN}`;
    await ensureBuilt(repoRoot);
    // Empty dbUrl -> the embedded PGlite the shipped app uses, so this needs no
    // PostgreSQL and does not have to skip on a machine that has none.
    server = spawnBuiltServer(repoRoot, "", PORT_PLAIN, NO_GROK_ENV);
    try {
      await waitForServer(base, 60_000);

      const oauth = await startGrokSignIn(base);
      assert.notEqual(oauth.status, 200, "the broker flow started with no Grok config");
      assert.doesNotMatch(
        oauth.text,
        /grok_preview|auth\.grok\.me/,
        `the response names the shared preview client: ${oauth.text.slice(0, 300)}`,
      );

      // The other half, and the reason the decoupling matters: a self-hosted
      // paper signs its editor in with email and password, on the same server,
      // with no broker anywhere.
      const signUp = await post(base, "/api/auth/sign-up/email", {
        name: "The Editor",
        email: `no-grok-${Date.now()}@example.test`,
        password: "an-operator-password-1234",
      });
      assert.equal(signUp.status, 200, signUp.text.slice(0, 300));
      assert.match(signUp.text, /"token"/, "email sign-up returned no session");
    } finally {
      // In `finally`, not on the success path: an assertion that fails is
      // exactly when the server most needs stopping, and a failed run that
      // leaves a listener behind poisons the next one.
      server.kill();
      server = undefined;
    }
  });

  it("under the sandbox opt-in: the broker is registered, so it is a door and not a wall", async () => {
    const base = `http://127.0.0.1:${PORT_PREVIEW}`;
    await ensureBuilt(repoRoot);
    server = spawnBuiltServer(repoRoot, "", PORT_PREVIEW, {
      ...NO_GROK_ENV,
      [GROK_PREVIEW_OPT_IN]: "1",
    });
    try {
      await waitForServer(base, 60_000);

      const oauth = await startGrokSignIn(base);
      assert.equal(oauth.status, 200, oauth.text.slice(0, 300));
      assert.match(oauth.text, /client_id=grok_preview/);
    } finally {
      server.kill();
      server = undefined;
    }
  });
});
