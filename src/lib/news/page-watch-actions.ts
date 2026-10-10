import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deskMiddleware } from "./desk-auth.ts";
const id = z.number().int().positive();
export const listPageWatches = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const { listPageWatchesFor } = await import("./page-watch.ts");
    return listPageWatchesFor(context);
  });
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
        modelEffort: z.string().max(20).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { createPageWatchFor } = await import("./page-watch.ts");
    return createPageWatchFor(context, {
      ...data,
      modelEffort: data.modelEffort as import("./provider-registry.ts").ModelEffort | null | undefined,
    });
  });
export const checkPageWatch = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => id.parse(input))
  .handler(async ({ context, data }) => {
    const { checkPageWatchFor } = await import("./page-watch.ts");
    return checkPageWatchFor(context, data);
  });
export const pageWatchDetail = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) =>
    z.object({ id, offset: z.number().int().min(0).max(100000).optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { pageWatchDetailFor } = await import("./page-watch.ts");
    return pageWatchDetailFor(context, data.id, data.offset);
  });
export const setPageWatchState = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) =>
    z.object({ id, state: z.enum(["active", "paused", "stopped"]) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { setPageWatchStateFor } = await import("./page-watch.ts");
    return setPageWatchStateFor(context, data.id, data.state);
  });
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
  .handler(async ({ context, data }) => {
    const { actOnPageWatchFor } = await import("./page-watch.ts");
    return actOnPageWatchFor(context, data);
  });

export const setPageWatchModel = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => z.object({ id, choice: z.string().max(40), effort: z.string().max(20).nullable().optional() }).parse(input))
  .handler(async ({ context, data }) => {
    const { setPageWatchModelFor } = await import("./page-watch.ts");
    return setPageWatchModelFor(context, data.id, data.choice, data.effort as import("./provider-registry.ts").ModelEffort | null | undefined);
  });
export const readPageWatchCapture = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown) =>
    z.object({ watchId: id, checkId: id, previous: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { readPageWatchCaptureFor } = await import("./page-watch.ts");
    return readPageWatchCaptureFor(context, data);
  });
