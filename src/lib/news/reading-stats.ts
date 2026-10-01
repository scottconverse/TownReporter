/*
  The Stats page's three authenticated reads.

  Same split as stats-reports.ts, and for the same reason (src/lib/db.ts's
  "server-only" guard, and rule 13 of the standing brief: a `*.server.ts` that
  a client bundle reaches takes the whole build down). Everything in this file
  is a `createServerFn` with `deskMiddleware` and an `await import()` of the
  server module INSIDE the handler -- so the query text, the schema statements
  and the `node:`-adjacent imports never enter the browser bundle, and the
  browser only ever carries three function references.

  Types cross back to the page with `import type` / `export type`, which is
  erased at compile time -- the same form src/lib/news/custom-ai-settings.ts
  uses for `PublicCustomAiConnection` and src/routes/desk.story.$leadId.tsx
  uses for `PullRunView`. No value is ever imported from a `.server.ts` here.

  All three refuse anyone who is not an editor: `requireEditor` is called
  inside `getReadingStats` / `exportReadingCsv` themselves (src/lib/news/
  reading.server.ts), not only in the middleware, so a test can prove the
  refusal without standing up the framework -- the shape `getViewStats`
  already uses.
*/

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deskMiddleware } from "./desk-auth.ts";
import { READING_RANGES } from "./reading.ts";

import type { LiveSnapshot } from "./reading-live.ts";
import type { ReadingCsv, ReadingStats } from "./reading.server.ts";

export type { LiveSnapshot };
export type { ReadingCsv, ReadingStats };

/**
 * Zod needs a literal tuple; `READING_RANGES` is the readonly one from
 * src/lib/news/reading.ts, which is also what the page's four buttons are
 * drawn from. One list, so a range the page can send is a range the server
 * accepts and vice versa.
 */
const rangeInput = z.object({ range: z.enum(READING_RANGES) });

/** The whole page's numbers, for the selected range. */
export const getReadingStatsFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator(rangeInput)
  .handler(async ({ context, data }) => {
    const reading = await import("./reading.server.ts");
    return reading.getReadingStats(context.userId, data.range);
  });

/**
 * "Reading right now" alone: no database, no query, just the in-memory window
 * (src/lib/news/reading-live.ts). Split out of the stats call so the panel can
 * refresh every fifteen seconds without re-running nine aggregate queries, and
 * so nothing about the live panel depends on the database being reachable.
 */
export const getReadingLiveFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async () => {
    const live = await import("./reading-live.ts");
    return live.liveSnapshot();
  });

/**
 * The rows behind the page, as CSV text. Deliberately not a route: the page
 * saves it through an object URL, so there is one download path and no new
 * unauthenticated URL returning a paper's traffic.
 */
export const exportReadingCsvFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator(rangeInput)
  .handler(async ({ context, data }) => {
    const reading = await import("./reading.server.ts");
    return reading.exportReadingCsv(context.userId, data.range);
  });
