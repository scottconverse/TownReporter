import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth";

/** The Server page line: is LibreOffice on this machine? */
export const libreOfficeStatusFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async () => {
    const { libreOfficeStatus } = await import("./libreoffice.server.ts");
    return { found: libreOfficeStatus().found };
  });

/** "Try again" on a Source documents line LibreOffice could not read. */
export const retryLibreOfficeDocumentFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: { id: string }) => {
    if (!data || typeof data.id !== "string" || !data.id || data.id.length > 80)
      throw new Error("Choose a document.");
    return { id: data.id };
  })
  .handler(async ({ data, context }) => {
    const { retryLibreOfficeDocument } = await import("./story-documents.server.ts");
    return retryLibreOfficeDocument(context.newsroomId ?? 1, data.id);
  });
