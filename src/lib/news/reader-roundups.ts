/** The three routine editions that are links in the events band, never story slots. */
export const ROUTINE_CHANNELS = ["today", "weekend", "deadlines"] as const;
export type RoutineChannel = (typeof ROUTINE_CHANNELS)[number];

export function isRoutineRoundupChannel(value: unknown): value is RoutineChannel {
  return typeof value === "string" && (ROUTINE_CHANNELS as readonly string[]).includes(value);
}

export type RoundupCandidate = {
  id: number;
  slug: string;
  headline: string;
  dek: string;
  publishedAt: string;
  channel: string;
};

export type ReaderRoundup = {
  slug: string;
  headline: string;
  dek: string;
  channel: RoutineChannel;
};

/**
 * The newest published story in each routine channel, at most one per channel
 * and at most three in all. The server asks for one newest row per channel;
 * keeping the pick pure makes the "newest, not merely first" rule testable.
 */
export function latestRoundups(rows: readonly RoundupCandidate[]): ReaderRoundup[] {
  const chosen: ReaderRoundup[] = [];
  const usedSlugs = new Set<string>();
  for (const channel of ROUTINE_CHANNELS) {
    const newest = rows
      .filter(
        (row) =>
          isRoutineRoundupChannel(row.channel) &&
          row.channel === channel &&
          row.headline.trim() &&
          !usedSlugs.has(row.slug),
      )
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id)[0];
    if (!newest) continue;
    chosen.push({
      slug: newest.slug,
      headline: newest.headline,
      dek: newest.dek,
      channel,
    });
    usedSlugs.add(newest.slug);
  }
  return chosen.slice(0, ROUTINE_CHANNELS.length);
}
