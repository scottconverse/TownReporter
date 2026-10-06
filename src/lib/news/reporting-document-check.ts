import type { PackageClaimStatus, PackageSource } from "./civic-reporting.ts";

/** Derived machine check; never part of WR1 claim identity or human judgment. */
export type CurrentReportingDocumentCheck = {
  state: "checked" | "unavailable";
  status: PackageClaimStatus | null;
  note: string;
  references: PackageSource[];
  checkedAt: string;
  inputFingerprint: string;
  filedClaimIdentity?: string;
};
export type CurrentReportingDocumentChecks = Record<string, Record<string, CurrentReportingDocumentCheck>>;

export function reportingDocumentClaimIdentity(id: string, text: string, item: string, references: PackageSource[]): string {
  return JSON.stringify([id, text, item, references.map((ref) => [ref.id, ref.title, ref.tier, ref.url, ref.locator, ref.offlineReference])]);
}
