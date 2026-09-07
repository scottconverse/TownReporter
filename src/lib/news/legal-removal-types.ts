export type LegalSelection = {
  articleIds: number[];
  draftIds: number[];
  memoryIds: number[];
  auditIds: number[];
  trashIds: number[];
  reviewedLegacy: boolean;
  reviewedEvidence: boolean;
};
export type LegalPreview = {
  selection: LegalSelection;
  fingerprint: string;
  articles: { id: number; headline: string }[];
  counts: Record<string, number>;
  candidates: { kind: "draftIds" | "memoryIds" | "auditIds" | "trashIds"; id: number; label: string }[];
  capturedCopies: { table: string; id: number }[];
  sharedInvestigationIds: number[];
  blockers: string[];
  reviewPending: boolean;
};
export type LegalRemovalInput = { selection: LegalSelection; fingerprint: string; policy: "retain" | "destroy"; caseRef: string };
