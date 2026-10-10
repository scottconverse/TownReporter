/**
 * The `createServerFn` shells for the editor's new dialogs (Unit BK).
 *
 * Deliberately thin: every one of them parses its input with a registered
 * schema from `request-input.ts` and hands the work to a `perform*` in
 * `editor-dialog-actions.server.ts`. Two entry points that were NOT added
 * here, because the desk already had them and the brief says to find the
 * existing path before writing a new one:
 *
 * - "Start a Dark Desk file" opens through `openDarkInvestigation` (`dark.ts`)
 *   and runs through `runDarkDesk`, both existing, both already carrying the
 *   provider probe and the spend preflight the dialog must not re-implement.
 * - The Headline dialog's three suggestions come from `suggestHeadlines`
 *   (`desk.ts`), which is the desk's own answer to a headline the editor does
 *   not like; only the press that KEEPS one is new (`chooseHeadline`).
 *
 * `insertLeadWithDraft` and `commitStoryDraftForAuthenticatedEditor` are
 * injected rather than imported by the `.server.ts` half, so the dialog logic
 * is testable under `node --test` (see the header there).
 */
import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import {
  addLeadInput,
  chooseHeadlineInput,
  findReplacementInput,
  findSourcesInput,
  holdLeadInput,
  sourceKillPatternInput,
  weaveIntoStoryInput,
} from "./request-input.ts";
import { insertLeadWithDraft } from "./desk.ts";
import { commitStoryDraftForAuthenticatedEditor } from "./model-request-commit.server.ts";
import {
  editorDialogDeps,
  performAddLead,
  performChooseHeadline,
  performFindReplacement,
  performFindSources,
  performHoldLead,
  performSourceKillPattern,
  performWeaveIntoStory,
} from "./editor-dialog-actions.server.ts";
import type { ModelEffort } from "./provider-registry.ts";

function owned(context: { newsroomId?: number }): number {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

function deps() {
  return editorDialogDeps({
    insertLead: insertLeadWithDraft,
    commitDraft: commitStoryDraftForAuthenticatedEditor,
  });
}

export const addLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => addLeadInput.parse(input))
  .handler(({ context, data }) =>
    performAddLead(
      { userId: context.userId, newsroomId: owned(context) },
      {
        paste: data.paste,
        override: data.override,
        why: data.why,
        then: data.then,
        modelChoice: data.modelChoice,
        modelEffort: data.modelEffort as ModelEffort | null | undefined,
      },
      deps(),
    ),
  );

export const holdLead = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => holdLeadInput.parse(input))
  .handler(({ context, data }) =>
    performHoldLead(
      { userId: context.userId, newsroomId: owned(context) },
      { id: data.id, choice: data.choice, note: data.note },
      deps(),
    ),
  );

export const sourceKillPattern = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => sourceKillPatternInput.parse(input))
  .handler(({ context, data }) =>
    performSourceKillPattern(
      { userId: context.userId, newsroomId: owned(context) },
      { sourceId: data.sourceId },
      deps(),
    ),
  );

export const findSources = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => findSourcesInput.parse(input))
  .handler(({ context, data }) =>
    performFindSources(
      { userId: context.userId, newsroomId: owned(context) },
      {
        topic: data.topic,
        scope: data.scope,
        modelChoice: data.modelChoice,
        modelEffort: data.modelEffort as ModelEffort | null | undefined,
      },
      deps(),
    ),
  );

/**
 * "Find a replacement" (SH0-9). Same shape as `findSources` above, and for the
 * same reason: the shell parses and hands over, and every rule about what may
 * be proposed lives on the far side of the one door.
 */
export const findReplacement = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => findReplacementInput.parse(input))
  .handler(({ context, data }) =>
    performFindReplacement(
      { userId: context.userId, newsroomId: owned(context) },
      {
        sourceId: data.sourceId,
        url: data.url,
        title: data.title,
        modelChoice: data.modelChoice,
        modelEffort: data.modelEffort as ModelEffort | null | undefined,
      },
      deps(),
    ),
  );

export const weaveIntoStory = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => weaveIntoStoryInput.parse(input))
  .handler(({ context, data }) =>
    performWeaveIntoStory(
      { userId: context.userId, newsroomId: owned(context) },
      {
        leadId: data.leadId,
        mode: data.mode,
        material: data.material,
        documentIds: data.documentIds,
        saveText: data.saveText,
        modelChoice: data.modelChoice,
        modelEffort: data.modelEffort as ModelEffort | null | undefined,
      },
      deps(),
    ),
  );

export const chooseHeadline = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => chooseHeadlineInput.parse(input))
  .handler(({ context, data }) =>
    performChooseHeadline(
      { userId: context.userId, newsroomId: owned(context) },
      { id: data.id, headline: data.headline },
      deps(),
    ),
  );
