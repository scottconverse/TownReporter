import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";
import { cleanYoutubeKeyInput, cleanYoutubeKeyTestInput } from "./request-input.ts";

/*
  The desk-facing half of the YouTube key box (0.6.70).

  Four calls, all editor-only, all of them keeping the key on the server side
  of the boundary:

    getYouTubeKeyStateFn   -- is a key saved, where does it come from, and how
                              many units has today spent?
    saveYouTubeApiKeyFn    -- store a pasted key, encrypted.
    removeYouTubeApiKeyFn  -- forget the stored key.
    testYouTubeApiKeyFn    -- one channels.list call, for a key typed into the
                              box or for the saved one.

  None of them returns the key. The state answers with `hasKey` and a sentence
  ("A key is saved", "No key; YouTube is read from the public feed"), which is
  all the browser is ever told. See youtube-data-api.server.ts for the store.
*/

export type {
  YouTubeKeyState,
  YouTubeKeyTest,
  YouTubeKeySource,
} from "./youtube-data-api.server";

export const getYouTubeKeyStateFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) =>
    (await import("./youtube-data-api.server")).getYouTubeKeyState(context.userId),
  );

export const saveYouTubeApiKeyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanYoutubeKeyInput(raw))
  .handler(async ({ context, data }) =>
    (await import("./youtube-data-api.server")).saveYouTubeApiKey(context.userId, data.apiKey),
  );

export const removeYouTubeApiKeyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) =>
    (await import("./youtube-data-api.server")).removeYouTubeApiKey(context.userId),
  );

export const testYouTubeApiKeyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => cleanYoutubeKeyTestInput(raw))
  .handler(async ({ context, data }) =>
    (await import("./youtube-data-api.server")).testYouTubeApiKey(context.userId, data.apiKey),
  );
