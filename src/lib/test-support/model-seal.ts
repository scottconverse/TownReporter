/*
  The test suite must never reach a real model server.

  It did. Every model and model-catalog request the desk makes goes out through
  one function -- `globalThis.fetch` -- and the test suite replaced that
  function only in the files that remembered to. Anywhere else, a test that
  resolved a provider ran against whatever was actually listening: on a machine
  with Ollama up, a real `POST /v1/chat/completions` with the editor's material
  in it, and on a machine with many cloud models pulled, automatic model choice
  could reach a *billed* one. CI has no model server, so nothing showed there;
  the cost and the false confidence only appeared on developer machines.

  So the seal is default-deny and it sits on `globalThis.fetch` itself, which
  is the lowest seam every caller shares: `ai.ts`'s readiness probes and chat
  calls, `local-models.ts`'s discovery (`/v1/models`, `/api/v0/models`,
  `/api/ps`, `/api/show`), `ocr.ts`'s transcription call,
  `custom-ai-connections.server.ts`'s catalog and connection tests, and the
  `@anthropic-ai/sdk`, which bypasses every module-level helper and calls this
  function directly. Sealing one of those call sites instead would have left
  the rest open.

  In a test process (`TOWNREPORTER_TEST_ENV_VERIFIED=1`, set by
  `scripts/test-environment.mjs` for `npm test`, for the focused
  `scripts/with-app-env.mjs node --test` run and for the real-Postgres lane) a
  request is refused when it names:

    - one of the three addresses a local model server listens on by default --
      127.0.0.1/localhost on 1234 (LM Studio), 11434 (Ollama) or 8080
      (llama.cpp's llama-server);
    - any non-loopback host at all, which is every real network destination;
    - a cloud model API host, named explicitly so the refusal can say which
      one and why rather than just "not loopback".

  Everything else is allowed, and deliberately so: a test that starts its own
  fake server on an ephemeral loopback port is doing exactly the right thing,
  and so is one that stubs `globalThis.fetch` -- replacing the transport means
  the request never leaves the process, and that stub simply replaces this
  function like any other.

  A developer who genuinely wants one live call sets
  `TOWNREPORTER_TEST_ALLOW_REAL_MODELS=1`. It is loud on purpose -- one line on
  stderr the first time a request is let through -- and CI must never set it
  (`scripts/model-seal-ci.test.mjs` fails the build if it ever does).
*/

/** Set by `scripts/test-environment.mjs` on every test process. */
export const TEST_RUN_ENV = "TOWNREPORTER_TEST_ENV_VERIFIED";

/** The single, explicit opt-in. Never set in CI. */
export const REAL_MODEL_OPT_IN_ENV = "TOWNREPORTER_TEST_ALLOW_REAL_MODELS";

/**
 * The three ports a local model server listens on by default, and the name of
 * the server on each. The addresses themselves are
 * `provider-registry.ts`'s `DISCOVERED_LOCAL_ADDRESSES`; this is the same list
 * keyed by port so a refusal can name the server it just refused.
 */
export const DEFAULT_LOCAL_MODEL_PORTS: Readonly<Record<number, string>> = {
  1234: "LM Studio",
  11434: "Ollama",
  8080: "llama.cpp",
};

/**
 * Hosts the desk knows how to reach a hosted model on. Listing them is not
 * what blocks them -- the non-loopback rule already does -- it is what lets
 * the refusal name the host instead of saying "somewhere on the network".
 */
export const CLOUD_MODEL_HOSTS: readonly string[] = [
  "api.anthropic.com",
  "api.openai.com",
  // NOT api.x.ai. Grok (xAI) is no longer a provider this desk can reach --
  // GR-C removed it, and `scripts/no-grok-provider.test.mjs` fails the build if
  // shipped code names it again. Naming it here to improve one error message
  // would trade a real invariant for a nicer sentence; the non-loopback rule
  // below already refuses it.
  "api.deepseek.com",
  "api.mistral.ai",
  "api.groq.com",
  "api.together.xyz",
  "openrouter.ai",
  "generativelanguage.googleapis.com",
  "dashscope.aliyuncs.com",
];

/** The marker that makes installation idempotent across preloads. */
const SEAL_MARK = Symbol.for("townreporter.modelSealInstalled");

function hostOf(url: URL): string {
  // `new URL("http://[::1]:11434/")` reports hostname "[::1]" in Node.
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/** 127.0.0.0/8, `localhost`, and IPv6 loopback -- the whole of "this machine". */
function isLoopback(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function defaultPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

/**
 * Why this URL may not be requested from a test process, or null when it may.
 *
 * Pure: takes the environment as an argument so the rule can be exercised
 * without mutating the real one, and never throws for a bad URL -- an
 * unparseable or relative specifier is not this function's business; `fetch`
 * will refuse it on its own terms.
 */
export function modelSealRefusal(
  rawUrl: string | URL,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env[TEST_RUN_ENV] !== "1") return null;
  if (env[REAL_MODEL_OPT_IN_ENV] === "1") return null;

  let url: URL;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl));
  } catch {
    return null;
  }

  const host = hostOf(url);
  const port = defaultPort(url);
  const optIn = `Set ${REAL_MODEL_OPT_IN_ENV}=1 to allow real model calls deliberately (never in CI).`;
  const instead =
    "Use a fake provider, or a fake server on an ephemeral loopback port, so the test exercises what it claims.";

  if (isLoopback(host)) {
    const server = DEFAULT_LOCAL_MODEL_PORTS[port];
    if (!server) return null; // a test's own fake server -- exactly what we want
    return (
      `Refusing a model request to ${url.href} during the test suite: ` +
      `port ${port} is ${server}'s default local address, and tests must never reach a real model server. ` +
      `${instead} ${optIn}`
    );
  }

  const cloud = CLOUD_MODEL_HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
  if (cloud) {
    return (
      `Refusing a model request to ${url.href} during the test suite: ${cloud} is a hosted model API, ` +
      `and a test that reaches it can spend the owner's money. ${instead} ${optIn}`
    );
  }

  return (
    `Refusing a request to ${url.href} during the test suite: ${host} is not loopback, and the ordinary ` +
    `suite is offline by design. ${instead} ${optIn}`
  );
}

/** Throw when the URL may not be requested from this process. */
export function assertModelRequestAllowed(
  rawUrl: string | URL,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const refusal = modelSealRefusal(rawUrl, env);
  if (refusal) throw new Error(refusal);
}

let optInAnnounced = false;

/**
 * The opt-in has to be impossible to miss: a run that reaches a live, possibly
 * billed model must not look like any other green run in the log.
 */
function announceOptIn(): void {
  if (optInAnnounced) return;
  optInAnnounced = true;
  process.stderr.write(
    `[model-seal] WARNING: ${REAL_MODEL_OPT_IN_ENV}=1 -- tests in this process may call real model ` +
      `servers and spend real money. Never set this in CI.\n`,
  );
}

function specifierOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

type SealedFetch = typeof fetch & { [SEAL_MARK]?: true };

/** Whether this process's `fetch` is already the sealed one. */
export function modelSealIsInstalled(): boolean {
  return Boolean((globalThis.fetch as SealedFetch)?.[SEAL_MARK]);
}

/**
 * Replace `globalThis.fetch` with the sealed one. Idempotent: the preloads
 * overlap (`run-tests-safe` and `with-app-env` can both load this file into
 * one process) and wrapping a wrapper would check the same URL twice.
 * Returns the function that puts the original back.
 */
export function installModelSeal(): () => void {
  const current = globalThis.fetch as SealedFetch;
  if (current?.[SEAL_MARK]) return () => {};

  const previous = globalThis.fetch.bind(globalThis);
  const sealed = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const refusal = modelSealRefusal(specifierOf(input));
    if (refusal) throw new Error(refusal);
    if (process.env[REAL_MODEL_OPT_IN_ENV] === "1" && process.env[TEST_RUN_ENV] === "1") {
      announceOptIn();
    }
    return previous(input, init);
  }) as SealedFetch;
  sealed[SEAL_MARK] = true;

  globalThis.fetch = sealed;
  return () => {
    globalThis.fetch = previous;
  };
}

/*
  Installed on import, because the seam is a global and the preloads that load
  this file are the only place it can be installed before a test starts. Inert
  outside a test run, so importing it from anywhere is safe.
*/
if (process.env[TEST_RUN_ENV] === "1") installModelSeal();
