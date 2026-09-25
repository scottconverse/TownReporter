/**
 * Where rung 2's server lives, declared once.
 *
 * 1234 is LM Studio's own port -- not a port a test picks. Local discovery
 * recognises an LM Studio server by that port and nothing else, and rung 2's
 * registry entry hardcodes it (src/lib/news/provider-registry.ts, `qwen-local`
 * -> http://127.0.0.1:1234/v1). Moving it with LLM_BASE_URL is not an option
 * here: that env var makes Automatic report "configured" and skip the ladder
 * entirely -- which is the thing these walks exist to exercise.
 *
 * BOTH ladder walks need an address, and scripts/fakes/fake-lmstudio-endpoint.mjs
 * needs the same default, so the number is written here once and imported.
 * scripts/integration-ports-are-unique.test.mjs fails the build when two files
 * each declare the same listen port; one shared owner is the fix that keeps
 * both walks honest, rather than a second copy of 1234 in a second walk.
 */

export const LMSTUDIO_PORT = 1234;
export const LMSTUDIO_BASE = `http://127.0.0.1:${LMSTUDIO_PORT}/v1`;
