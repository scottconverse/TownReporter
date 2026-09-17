export type EvidenceReviewPeerSnapshot = {
  draftId: number;
  contentToken: string;
  rows: Array<{ key: string }>;
  claimRows: Array<{ key: string }>;
  manualClaimRows?: Array<{ key: string }>;
};

export function canRebaseDirtyEvidencePeers(
  previous: EvidenceReviewPeerSnapshot | null,
  next: EvidenceReviewPeerSnapshot,
  peerKeys: string[],
) {
  const rowForKey = (review: EvidenceReviewPeerSnapshot, key: string) =>
    [...review.rows, ...review.claimRows, ...(review.manualClaimRows ?? [])].find(
      (row) => row.key === key,
    );
  return Boolean(
    previous &&
    previous.draftId === next.draftId &&
    previous.contentToken === next.contentToken &&
    peerKeys.every((key) => {
      const before = rowForKey(previous, key);
      const after = rowForKey(next, key);
      return Boolean(before && after && JSON.stringify(before) === JSON.stringify(after));
    }),
  );
}
