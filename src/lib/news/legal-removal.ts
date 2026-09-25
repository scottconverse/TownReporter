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
import { legalCaseId, legalBackupInput, legalRemovalInput, legalSelectionInput } from "./request-input.ts";

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
  .validator((data: LegalSelection) => legalSelectionInput.parse(data))
  .handler(({ context, data }) => response(() => previewLegalRemoval(context.userId, data)));
export const legalConfirm = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: LegalRemovalInput) => legalRemovalInput.parse(data))
  .handler(({ context, data }) => response(() => removeLegally(context.userId, data)));
export const legalCases = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(({ context }) => response(() => listLegalCases(context.userId)));
export const legalCase = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: unknown) => legalCaseId.parse(id))
  .handler(({ context, data }) => response(() => getLegalCase(context.userId, data)));
export const legalRetainedCopy = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: unknown) => legalCaseId.parse(id))
  .handler(({ context, data }) => response(() => readLegalCopy(context.userId, data)));
export const legalBackupAction = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: { caseId: string; identifier?: string; confirmId?: number }) => legalBackupInput.parse(data))
  .handler(({ context, data }) =>
    response(() => recordBackupAction(context.userId, data.caseId, data)),
  );
