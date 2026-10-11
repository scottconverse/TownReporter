import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware, assertOwner } from "./desk-auth.ts";
import { cleanMailboxInput, cleanSourceNewsletterInput } from "./newsletter-input.ts";

export type {
  NewsletterMailboxView,
  NewsletterWaitingItem,
} from "./newsletter-api.server.ts";

/** Editor-readable status. */
export const getNewsletterMailboxFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const { readMailboxView } = await import("./newsletter-api.server.ts");
    return readMailboxView(context.newsroomId);
  });

/** Owner-only save. `password` blank/omitted preserves the stored one. */
export const saveNewsletterMailboxFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => cleanMailboxInput(raw))
  .handler(async ({ context, data }) => {
    assertOwner(context.role);
    const { saveNewsletterMailbox } = await import("./newsletter-api.server.ts");
    return saveNewsletterMailbox({
      userId: context.userId,
      newsroomId: context.newsroomId,
      address: data.address,
      host: data.host,
      port: data.port,
      ssl: data.ssl,
      password: data.password,
    });
  });

/** Owner-only test of the saved mailbox. */
export const testNewsletterMailboxFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    assertOwner(context.role);
    const { testSavedMailbox } = await import("./newsletter-api.server.ts");
    return testSavedMailbox(context.newsroomId);
  });

/** Editor-readable per-source newsletter identity. */
export const getSourceNewsletterFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => {
    const sourceId = Number((raw as { sourceId?: unknown })?.sourceId);
    if (!Number.isInteger(sourceId) || sourceId <= 0) throw new Error("Choose a source first.");
    return { sourceId };
  })
  .handler(async ({ context, data }) => {
    const { readSourceNewsletter } = await import("./newsletter-api.server.ts");
    return readSourceNewsletter(context.newsroomId, data.sourceId);
  });

/** Editor-readable save of per-source newsletter identity. */
export const saveSourceNewsletterFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => cleanSourceNewsletterInput(raw))
  .handler(async ({ context, data }) => {
    const { writeSourceNewsletter } = await import("./newsletter-api.server.ts");
    return writeSourceNewsletter(context.newsroomId, data);
  });
