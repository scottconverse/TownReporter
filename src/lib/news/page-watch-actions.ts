import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deskMiddleware } from "./desk-auth.ts";
import {
  createPageWatchFor,
  checkPageWatchFor,
  listPageWatchesFor,
  pageWatchDetailFor,
  setPageWatchStateFor,
  actOnPageWatchFor,
  setPageWatchModelFor,
  readPageWatchCaptureFor,
} from "./page-watch.ts";
const id = z.number().int().positive();
export const listPageWatches = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(({ context }) => listPageWatchesFor(context));
export const createPageWatch = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        url: z.string().max(2048),
        name: z.string().max(200),
        reason: z.string().max(2000),
        investigationId: id.nullable().optional(),
        modelChoice: z.string().max(40).optional(),
      })
      .parse(input),
  )
  .handler(({ context, data }) => createPageWatchFor(context, data));
export const checkPageWatch = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => id.parse(input))
  .handler(({ context, data }) => checkPageWatchFor(context, data));
export const pageWatchDetail = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) =>
    z.object({ id, offset: z.number().int().min(0).max(100000).optional() }).parse(input),
  )
  .handler(({ context, data }) => pageWatchDetailFor(context, data.id, data.offset));
export const setPageWatchState = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) =>
    z.object({ id, state: z.enum(["active", "paused", "stopped"]) }).parse(input),
  )
  .handler(({ context, data }) => setPageWatchStateFor(context, data.id, data.state));
export const actOnPageWatch = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        watchId: id,
        checkId: id,
        action: z.enum(["lead", "attach", "dismiss"]),
        sectionKey: z.string().max(80).optional(),
        investigationId: id.optional(),
      })
      .parse(input),
  )
  .handler(({ context, data }) => actOnPageWatchFor(context, data));

export const setPageWatchModel = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => z.object({ id, choice: z.string().max(40) }).parse(input))
  .handler(({ context, data }) => setPageWatchModelFor(context, data.id, data.choice));
export const readPageWatchCapture = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) =>
    z.object({ watchId: id, checkId: id, previous: z.boolean().optional() }).parse(input),
  )
  .handler(({ context, data }) => readPageWatchCaptureFor(context, data));
