import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth.ts";
import type { RoutineField, RoutineNoticeFormatKey } from "./routine-notice-types.ts";

export type RoutineNoticeCheckErrorCode =
  | "forbidden"
  | "not-found"
  | "conflict"
  | "invalid-input"
  | "policy-paused"
  | "approval-invalid"
  | "capture-failed"
  | "adapter-unavailable";

export type RoutineNoticeCheckState =
  | "parsed"
  | "parsed-with-conflicts"
  | "refused"
  | "capture-failed"
  | "adapter-unavailable"
  | "evidence-unavailable";

export type RoutineNoticeCandidateView = {
  id: number;
  externalIdHash: string;
  formatKey: RoutineNoticeFormatKey;
  variant: string;
  fields: Record<string, RoutineField>;
  conflict: boolean;
};

export type RoutineNoticeCheckGroup = {
  checkId: number;
  source: { id: number; title: string; url: string; sourceHref: string };
  formatKey: RoutineNoticeFormatKey;
  checkedAt: string;
  capture: {
    captureEventId: number;
    artifactVersionId: number | null;
    observedAt: string;
    evidenceHref: null;
    textAvailable: boolean;
  } | null;
  state: RoutineNoticeCheckState;
  counts: { parsed: number; refused: number; conflicts: number };
  refusals: Array<{ code: string; locator: string; count: number }>;
  candidates: RoutineNoticeCandidateView[];
  newerCaptureAvailable: boolean;
  policy: { revision: number; paused: boolean; approvalValid: boolean };
  canCheck: boolean;
};

type Failure = { ok: false; code: RoutineNoticeCheckErrorCode; error: string };
export type RoutineNoticeCheckResult = { ok: true; check: RoutineNoticeCheckGroup } | Failure;
export type RoutineNoticeChecksResult = { ok: true; groups: RoutineNoticeCheckGroup[] } | Failure;
export type RoutineNoticeCapturedTextResult =
  | {
      ok: true;
      capture: {
        title: string | null;
        url: string;
        capturedAt: string | null;
        fullText: string;
        textKind: "raw-html";
        truncated: boolean;
      };
    }
  | {
      ok: false;
      code: "forbidden" | "not-found" | "conflict";
      error: string;
    };

export type CheckRoutineNoticeInput = {
  requestId: string;
  sourceId: number;
  sourceUrl: string;
  formatKey: RoutineNoticeFormatKey;
  expectedPolicyRevision: number;
};

const failure = (error: unknown): Failure => {
  const value = error as { code?: RoutineNoticeCheckErrorCode; message?: string };
  return {
    ok: false,
    code: value?.code ?? "invalid-input",
    error: value?.message ?? "Routine notice check failed.",
  };
};

export const checkRoutineNoticeSource = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((value: unknown) => value)
  .handler(async ({ context, data }): Promise<RoutineNoticeCheckResult> => {
    try {
      return await (await import("./routine-notice-checks.server.ts")).checkRoutineNoticeSourceForOwner(
        { userId: context.userId, newsroomId: context.newsroomId },
        data,
      );
    } catch (error) {
      return failure(error);
    }
  });

export const getRoutineNoticeChecks = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((value: unknown) => value)
  .handler(async ({ context, data }): Promise<RoutineNoticeChecksResult> => {
    try {
      return {
        ok: true,
        groups: await (await import("./routine-notice-checks.server.ts")).listRoutineNoticeChecksForOwner(
          { userId: context.userId, newsroomId: context.newsroomId },
          data,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  });

export const getRoutineNoticeCapturedText = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((value: unknown) => value)
  .handler(async ({ context, data }): Promise<RoutineNoticeCapturedTextResult> => {
    try {
      return {
        ok: true,
        capture: await (await import("./routine-notice-checks.server.ts")).readRoutineNoticeCapturedTextForOwner(
          { userId: context.userId, newsroomId: context.newsroomId },
          data,
        ),
      };
    } catch (error) {
      const result = failure(error);
      return {
        ok: false,
        code: ["forbidden", "not-found", "conflict"].includes(result.code)
          ? (result.code as "forbidden" | "not-found" | "conflict")
          : "not-found",
        error: result.error,
      };
    }
  });
