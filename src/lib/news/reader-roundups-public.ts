import { createServerFn } from "@tanstack/react-start";
import { listLatestRoundups } from "./reader-roundups.server.ts";

/** The route-facing half of the roundups read; the database stays in the handler. */
export const readerRoundups = createServerFn({ method: "GET" }).handler(() =>
  listLatestRoundups(),
);
