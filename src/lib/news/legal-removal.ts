import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth";
import {
  previewLegalRemoval,
  removeLegally,
  listLegalCases,
  getLegalCase,
  readLegalCopy,
  recordBackupAction,
} from "./legal-removal-store";
import type { LegalSelection, LegalRemovalInput } from "./legal-removal-types";

async function response<T>(work: () => Promise<T>) {
  try {
    return { ok: true as const, value: await work() };
  } catch (error) {
    const safe =
      error instanceof Error && (error.name === "Error" || error.name === "ForbiddenError");
    return {
      ok: false as const,
      error: safe
        ? error.message
        : "The database could not complete this action. Nothing is confirmed; reload the case and retry.",
    };
  }
}
export const legalPreview = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: LegalSelection) => data)
  .handler(({ context, data }) => response(() => previewLegalRemoval(context.userId, data)));
export const legalConfirm = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: LegalRemovalInput) => data)
  .handler(({ context, data }) => response(() => removeLegally(context.userId, data)));
export const legalCases = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(({ context }) => response(() => listLegalCases(context.userId)));
export const legalCase = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: string) => String(id))
  .handler(({ context, data }) => response(() => getLegalCase(context.userId, data)));
export const legalRetainedCopy = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: string) => String(id))
  .handler(({ context, data }) => response(() => readLegalCopy(context.userId, data)));
export const legalBackupAction = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: { caseId: string; identifier?: string; confirmId?: number }) => data)
  .handler(({ context, data }) =>
    response(() => recordBackupAction(context.userId, data.caseId, data)),
  );
