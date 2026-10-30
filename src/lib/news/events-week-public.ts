import { createServerFn } from "@tanstack/react-start";
import { readFrontEventsWeek } from "./events-week.server.ts";

/** The route-facing shell; the database and clock stay inside the server handler. */
export const frontEventsWeek = createServerFn({ method: "GET" }).handler(() =>
  readFrontEventsWeek(),
);
