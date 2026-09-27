import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { listStoryDates, listThisWeekDates } from "./story-dates.server.ts";

/**
 * The two dated-item reads, as server functions.
 *
 * Same split as `reader-public.ts`: the route may import this file and nothing
 * else, and the database sits behind the handler, which the bundler strips
 * from the client build along with the import above it.
 */

/** "This week": the next seven days of dates on printed stories. */
export const thisWeekDates = createServerFn({ method: "POST" }).handler(() =>
  listThisWeekDates(),
);

/** "Dates in this story": the dates the one printed story carries. */
export const articleDates = createServerFn({ method: "POST" })
  .validator(z.object({ slug: z.string().min(1).max(300) }))
  .handler(({ data }) => listStoryDates(data.slug));
