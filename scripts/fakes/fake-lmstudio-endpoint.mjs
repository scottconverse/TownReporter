#!/usr/bin/env node
/**
 * A stand-in for LM Studio's local server, for the browser walks that must
 * keep Automatic's rung 2 (Qwen 3.6 35B, `qwen-local`) skipping with a real
 * reason on a machine that has no LM Studio running.
 *
 * Rung 2 is the one ladder entry that carries `requiresLoadedLocalModel`, so
 * before it is tried the desk asks the local catalog whether that model is
 * present and loaded (src/lib/news/ai.ts's `skippedRungReason`, reading
 * src/lib/news/local-models.ts). Two conditions have to hold for the desk to
 * say "not loaded" rather than something else:
 *
 *   1. a server has to be found AT THE RUNG'S OWN baseUrl and be reachable --
 *      otherwise the reason is "its server did not answer";
 *   2. that server must not list the rung's model as loaded.
 *
 * Condition 1 is why this fake listens on 1234 by default: local discovery
 * identifies a server as an LM Studio one by its port (`inferKind`), and it
 * only probes the three default ports plus LLM_BASE_URL -- a fake on any
 * other port is never probed at all unless LLM_BASE_URL points at it, and
 * LLM_BASE_URL makes Automatic skip the ladder entirely. A test port cannot
 * be used here.
 *
 * Condition 2 is the point of the fake: /v1/models and /api/v0/models list one
 * small chat model and deliberately NOT the rung's model, so the catalog entry
 * is reachable, is an LM Studio server, reports load state (so the verdict is
 * a definite "not loaded" rather than "load state unknown"), and simply does
 * not have the model.
 *
 *   FAKE_LMSTUDIO_PORT  port to listen on (default `LMSTUDIO_PORT`; see above
 *                       -- another port is almost certainly the wrong test)
 *   FAKE_LMSTUDIO_MODEL the one model it does list as loaded
 *                       (default "fake-lmstudio-small", type llm)
 *
 * There is no /v1/chat/completions route on purpose. If the rung is ever
 * reached, this server must NOT quietly answer as if a real 35B model had
 * written something -- a 404 makes the run fail with the fake's own name in
 * it, which is what a walk wants to see if the skip stopped working.
 */
import { createServer } from "node:http";
import { LMSTUDIO_PORT } from "./lmstudio-address.mjs";

const PORT = Number(process.env.FAKE_LMSTUDIO_PORT || LMSTUDIO_PORT);
const MODEL = process.env.FAKE_LMSTUDIO_MODEL || "fake-lmstudio-small";

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
          state: "loaded",
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
    `fake-lmstudio: listening on http://127.0.0.1:${PORT} (loaded model ${MODEL}, ` +
      `no qwen rung model)\n`,
  );
});
