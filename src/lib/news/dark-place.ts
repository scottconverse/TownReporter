/** Geography already configured in Paper setup; never guess nearby jurisdictions. */
export type NewsroomPlace = { city: string; state: string; county?: string | null };
export const LONGMONT_PLACE: NewsroomPlace = {
  city: "Longmont",
  state: "Colorado",
  county: "Boulder",
};
export function isLongmont(place: NewsroomPlace): boolean {
  return (
    place.city.trim().toLowerCase() === "longmont" &&
    ["colorado", "co"].includes(place.state.trim().toLowerCase())
  );
}
export function subredditFromSources(urls: string[]): string | null {
  const names = new Set<string>();
  for (const raw of urls)
    try {
      const url = new URL(raw);
      if (!/(^|\.)reddit\.com$/i.test(url.hostname)) continue;
      const match = url.pathname.match(/^\/r\/([a-z0-9_]{2,21})(?:\/|$)/i);
      if (match) names.add(match[1].toLowerCase());
    } catch {
      /* A malformed source does not establish a subreddit. */
    }
  return names.size === 1 ? [...names][0] : null;
}
