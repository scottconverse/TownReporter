/*
  The three Ollama calls the desk makes (DEF-2).

  Same shape as provider-availability.ts: `deskMiddleware` for a signed-in
  newsroom member, the server-only module imported inside the handler so the
  client bundle never sees `node:child_process`.

  - `getOllamaStatus`   read-only. Answers the warning box. Never starts anything.
  - `checkOllamaAgain`  the box's own button. Re-probes, and starts the app's
                        own copy on 11435 when Ollama is installed but stopped.
  - `startOllamaSignIn` owner-only. Runs `ollama signin` on this machine.
  - `pollOllamaSignIn` / `cancelOllamaSignIn` follow that attempt.
*/

import { createServerFn } from "@tanstack/react-start";
import { assertOwner, deskMiddleware } from "./desk-auth.ts";
import type { OllamaStatus } from "./ollama-status.ts";
import type { OllamaSignIn } from "./ollama-signin.server.ts";

export type { OllamaStatus } from "./ollama-status.ts";
export type { OllamaSignIn } from "./ollama-signin.server.ts";

export const getOllamaStatus = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async (): Promise<OllamaStatus> =>
    (await import("./ollama-supervision.server.ts")).ollamaStatus(),
  );

export const checkOllamaAgain = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async (): Promise<OllamaStatus> => {
    const mod = await import("./ollama-supervision.server.ts");
    const answer = await mod.ensureOllama({ force: true });
    return {
      running: answer.running,
      root: answer.root,
      endpoint: answer.endpoint,
      supervised: answer.supervised,
      installed: answer.installed,
      startedAt: answer.startedAt,
    };
  });

export const startOllamaSignIn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<OllamaSignIn> => {
    assertOwner(context.role);
    return (await import("./ollama-signin.server.ts")).startOllamaSignIn();
  });

export const pollOllamaSignIn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async (): Promise<OllamaSignIn | null> =>
    (await import("./ollama-signin.server.ts")).pollOllamaSignIn(),
  );

export const cancelOllamaSignIn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<OllamaSignIn | null> => {
    assertOwner(context.role);
    return (await import("./ollama-signin.server.ts")).cancelOllamaSignIn();
  });
