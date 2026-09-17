import type { RoutineNoticeFormatKey } from "../lib/news/routine-notice-policy";

export type RoutineApprovalDraft = {
  sourceId: number;
  sourceUrl: string;
  formatKey: RoutineNoticeFormatKey;
};

export function isCurrentRoutineApproval(
  approvals: readonly RoutineApprovalDraft[],
  source: { id: number; url: string },
  formatKey: RoutineNoticeFormatKey,
) {
  return approvals.some(
    (approval) =>
      approval.sourceId === source.id &&
      approval.formatKey === formatKey &&
      approval.sourceUrl === source.url,
  );
}

export function withoutRoutineApproval(
  approvals: readonly RoutineApprovalDraft[],
  source: { id: number },
  formatKey: RoutineNoticeFormatKey,
): RoutineApprovalDraft[] {
  return approvals.filter(
    (approval) => approval.sourceId !== source.id || approval.formatKey !== formatKey,
  );
}

export function replaceRoutineApproval(
  approvals: readonly RoutineApprovalDraft[],
  source: { id: number; url: string },
  formatKey: RoutineNoticeFormatKey,
): RoutineApprovalDraft[] {
  return [...withoutRoutineApproval(approvals, source, formatKey), {
    sourceId: source.id,
    sourceUrl: source.url,
    formatKey,
  }];
}
