#!/usr/bin/env node
/**
 * A stand-in for LM Studio's local server, for the browser walks that must
 * keep Automatic's rung 2 (`qwen-local`, label "Local model") skipping with a
 * real reason on a machine that has no LM Studio running.
 *
 * Rung 2 is the one ladder entry that carries `requiresLoadedLocalModel`, so
 * before it is tried the desk asks the local catalog what LM Studio has
 * LOADED right now (src/lib/news/ai.ts's `resolveRungLocalModel`, reading
 * src/lib/news/local-models.ts). Three conditions have to hold for the desk to
 * say "nothing loaded in LM Studio" rather than something else:
 *
 *   1. a server has to be found AT THE RUNG'S OWN baseUrl and be reachable --
 *      otherwise the reason is "its server did not answer";
 *   2. that server has to list at least one model in a form the catalog can
 *      read at all -- an empty /v1/models is not a probing failure here, but
 *      the rung still needs a listing to reason over;
 *   3. the native /api/v0/models listing has to report load state and report
 *      NOTHING loaded -- a server that reports no state at all gets "load
 *      state unknown" instead, which is a different sentence.
 *
 * Condition 1 is why this fake listens on 1234 by default: local discovery
 * identifies a server as an LM Studio one by its port (`inferKind`), and it
 * only probes the three default ports plus LLM_BASE_URL -- a fake on any
 * other port is never probed at all unless LLM_BASE_URL points at it, and
 * LLM_BASE_URL makes Automatic skip the ladder entirely. A test port cannot
 * be used here.
 *
 * Condition 3 is the point of the fake, and it is what changed in 0.6.69
 * (Unit AL item 4). Until then the rung named a model, so "not loaded" was
 * proven by listing the models and leaving THAT ONE out. The rung now runs
 * whatever is loaded, so the only way to keep it skipped is to report a model
 * the server has on disk and NOT loaded -- `state: "not-loaded"` in the native
 * listing, which is a state LM Studio really uses (`lms ps --json` reports
 * "not-loaded" for a model that is downloaded but not in memory).
 *
 *   FAKE_LMSTUDIO_PORT   port to listen on (default `LMSTUDIO_PORT`; see above
 *                        -- another port is almost certainly the wrong test)
 *   FAKE_LMSTUDIO_MODEL  the one model it lists on disk
 *                        (default "fake-lmstudio-small", type llm)
 *   FAKE_LMSTUDIO_STATE  that model's load state in /api/v0/models (default
 *                        "not-loaded"). Set it to "loaded" to prove the
 *                        OPPOSITE case -- that the rung becomes runnable and
 *                        is tried -- and expect the 404 below.
 *
 * There is no /v1/chat/completions route on purpose. If the rung is ever
 * reached, this server must NOT quietly answer as if a real model had written
 * something -- a 404 makes the run fail with the fake's own name in it, which
 * is what a walk wants to see if the skip stopped working.
 */
import { createServer } from "node:http";
import { LMSTUDIO_PORT } from "./lmstudio-address.mjs";

const PORT = Number(process.env.FAKE_LMSTUDIO_PORT || LMSTUDIO_PORT);
const MODEL = process.env.FAKE_LMSTUDIO_MODEL || "fake-lmstudio-small";
// "not-loaded" keeps rung 2 skipping, which is what every walk here wants:
// since 0.6.69 the rung runs whatever is loaded, so a listing that says
// "loaded" would make it runnable and the walk would 404 on chat below.
const STATE = process.env.FAKE_LMSTUDIO_STATE || "not-loaded";

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

const server = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  process.stdout.write(`fake-lmstudio: ${req.method} ${path}\n`);

  if (path.endsWith("/v1/models") || path === "/models") {
    // The OpenAI-compatible shape parseModelIds reads: {data:[{id}...]}.
    return send(res, 200, {
      object: "list",
      data: [{ id: MODEL, object: "model", owned_by: "fake-lmstudio" }],
    });
  }
  if (path === "/api/v0/models") {
    // LM Studio's native list, which is where `loaded` and `type` come from.
    return send(res, 200, {
      data: [
        {
          id: MODEL,
          object: "model",
          type: "llm",
          publisher: "fake",
          state: STATE,
          max_context_length: 4096,
        },
      ],
    });
  }
  return send(res, 404, { error: `fake-lmstudio has no route ${req.method} ${path}` });
});

server.on("error", (error) => {
  const detail =
    error && error.code === "EADDRINUSE"
      ? `port ${PORT} is already in use -- a real server (LM Studio?) is on it, and rung 2's ` +
        `port has to be 1234 for local discovery to see this as an LM Studio server`
      : String(error);
  process.stderr.write(`fake-lmstudio: ${detail}\n`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(
    `fake-lmstudio: listening on http://127.0.0.1:${PORT} (model ${MODEL} is ${STATE}, ` +
      `so rung 2 has nothing loaded to run)\n`,
  );
});
