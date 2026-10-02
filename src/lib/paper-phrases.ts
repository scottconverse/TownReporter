/*
  Sentences that name the town, built so a paper with no town reads cleanly.

  Auditor finding F4/F5: an install that has NOT completed first-run setup
  serves `UNCONFIGURED_PAPER_CONFIG` (src/lib/news/paper-settings.ts), whose
  `city` is the empty string. Every sentence below used to interpolate the
  city with no branch, so the public pages printed a dangling preposition --
  "A clearer view of .", "Today in  · Sat, Sept. 26", "Independent civic
  reporting for ", "We follow 's meetings" -- which reads as a broken page
  rather than as "this paper has not said where it is yet".

  Each helper keeps the configured wording BYTE-FOR-BYTE when a city IS set
  (`paper-phrases.test.ts` pins that), and drops the town phrase rather than
  the preposition when it is not. Pure strings, no React, no database: this
  module is loaded by client components and by a plain node test.
*/

/**
 * The dateline bar's "Today in {town} · Sat, Sept. 26".
 *
 * With no town the dateline is the day alone. "Today in " with nothing after
 * it is not a dateline; the day stamp is the fact the bar exists to carry.
 */
export function datelineLine(city: string, stamp: string): string {
  const town = city.trim();
  return town ? `Today in ${town} · ${stamp}` : stamp;
}

/** The footer's "A clearer view of {town}." — the generic wording when unnamed. */
export function clearerViewSentence(city: string): string {
  const town = city.trim();
  return town ? `A clearer view of ${town}.` : "A clearer view of your community.";
}

/** About's standfirst, "Independent civic reporting for {town}". */
export function civicReportingLine(city: string): string {
  const town = city.trim();
  return town ? `Independent civic reporting for ${town}` : "Independent civic reporting";
}

/**
 * About's "We follow {town}'s meetings, money, contracts and public records
 * — then keep digging ...".
 *
 * With no town it is "the meetings, money, ...": the paper still describes
 * what it follows, it simply does not claim a town it has not named.
 */
export function aboutFollowSentence(city: string): string {
  const town = city.trim();
  const subject = town ? `${town}’s` : "the";
  return (
    `We follow ${subject} meetings, money, contracts and public records — ` +
    "then keep digging when something changes, disappears or doesn’t add up."
  );
}

/** How-we-report's "a list of {town} civic sources" — "civic sources" when unnamed. */
export function civicSourcesPhrase(city: string): string {
  const town = city.trim();
  return town ? `${town} civic sources` : "civic sources";
}

/**
 * The archive head's "Reporting on {topic} in {town}." — "Reporting on
 * {topic}." when the paper has not named a town.
 */
export function topicReportingSentence(topic: string, city: string): string {
  const town = city.trim();
  return town ? `Reporting on ${topic} in ${town}.` : `Reporting on ${topic}.`;
}

/** The Queue's composer placeholder, "Why this is news in {town} today". */
export function newsInTownPlaceholder(city: string): string {
  const town = city.trim();
  return town ? `Why this is news in ${town} today` : "Why this is news today";
}
