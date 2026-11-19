/**
 * F01 (live walk 2026-11-19): is a story, or a lead, about another state rather
 * than this paper's own ground?
 *
 * The real case: a Plymouth Superior Court story about Duxbury, Mass. was filed
 * under "Nearby" on the Longmont, Colorado paper, because "Superior" is a
 * Nearby town and nothing looked at the state. This module answers the
 * geography question the desk needs -- does the text name a place in some
 * other state, and name nothing of this paper's own?
 *
 * Rule, kept small and plain: a US state counts when it is written after a
 * comma as a dateline does -- `Louisville, Ky.`, `Erie, Pennsylvania`,
 * `Duxbury, Mass.` -- as a full name or its AP abbreviation. A story is
 * "out of state" when it names one of those and names neither the paper's
 * state, the paper's city, its county, nor one of its Nearby towns.
 *
 * WARN, NEVER BLOCK: this never changes a status, drops a lead or refuses a
 * publish. The Queue and the draft each draw one plain line.
 *
 * Pure and free of imports so it can be tested on its own and run in the
 * browser on a row's own words, with no schema change and no backfill.
 */

/** The words the desk shows. One sentence, no jargon. */
export const OUT_OF_STATE_WARNING = "This story may be about another state, not Colorado";

/** The state the shipped paper is in, used when the caller has no identity. */
const DEFAULT_STATE = "Colorado";

/**
 * Each state's full name and the AP abbreviation(s) the paper may write after
 * a town. States whose AP style is the full name (Alaska, Hawaii, Idaho, Iowa,
 * Maine, Ohio, Texas, Utah) carry that name again, so a dateline like
 * `Dallas, Texas` matches the same way as `Duxbury, Mass.`.
 */
const STATES: readonly { name: string; abbrs: readonly string[] }[] = [
  { name: "Alabama", abbrs: ["Ala."] },
  { name: "Alaska", abbrs: ["Alaska"] },
  { name: "Arizona", abbrs: ["Ariz."] },
  { name: "Arkansas", abbrs: ["Ark."] },
  { name: "California", abbrs: ["Calif."] },
  { name: "Colorado", abbrs: ["Colo."] },
  { name: "Connecticut", abbrs: ["Conn."] },
  { name: "Delaware", abbrs: ["Del."] },
  { name: "Florida", abbrs: ["Fla."] },
  { name: "Georgia", abbrs: ["Ga."] },
  { name: "Hawaii", abbrs: ["Hawaii"] },
  { name: "Idaho", abbrs: ["Idaho"] },
  { name: "Illinois", abbrs: ["Ill."] },
  { name: "Indiana", abbrs: ["Ind."] },
  { name: "Iowa", abbrs: ["Iowa"] },
  { name: "Kansas", abbrs: ["Kan."] },
  { name: "Kentucky", abbrs: ["Ky."] },
  { name: "Louisiana", abbrs: ["La."] },
  { name: "Maine", abbrs: ["Maine"] },
  { name: "Maryland", abbrs: ["Md."] },
  { name: "Massachusetts", abbrs: ["Mass."] },
  { name: "Michigan", abbrs: ["Mich."] },
  { name: "Minnesota", abbrs: ["Minn."] },
  { name: "Mississippi", abbrs: ["Miss."] },
  { name: "Missouri", abbrs: ["Mo."] },
  { name: "Montana", abbrs: ["Mont."] },
  { name: "Nebraska", abbrs: ["Neb."] },
  { name: "Nevada", abbrs: ["Nev."] },
  { name: "New Hampshire", abbrs: ["N.H."] },
  { name: "New Jersey", abbrs: ["N.J."] },
  { name: "New Mexico", abbrs: ["N.M."] },
  { name: "New York", abbrs: ["N.Y."] },
  { name: "North Carolina", abbrs: ["N.C."] },
  { name: "North Dakota", abbrs: ["N.D."] },
  { name: "Ohio", abbrs: ["Ohio"] },
  { name: "Oklahoma", abbrs: ["Okla."] },
  { name: "Oregon", abbrs: ["Ore."] },
  { name: "Pennsylvania", abbrs: ["Pa."] },
  { name: "Rhode Island", abbrs: ["R.I."] },
  { name: "South Carolina", abbrs: ["S.C."] },
  { name: "South Dakota", abbrs: ["S.D."] },
  { name: "Tennessee", abbrs: ["Tenn."] },
  { name: "Texas", abbrs: ["Texas"] },
  { name: "Utah", abbrs: ["Utah"] },
  { name: "Vermont", abbrs: ["Vt."] },
  { name: "Virginia", abbrs: ["Va."] },
  { name: "Washington", abbrs: ["Wash."] },
  { name: "West Virginia", abbrs: ["W.Va."] },
  { name: "Wisconsin", abbrs: ["Wis."] },
  { name: "Wyoming", abbrs: ["Wyo."] },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `text` names `name` as a whole word, case-sensitively. */
function namesWholeWord(text: string, name: string): boolean {
  const word = name.trim();
  if (!word) return false;
  return new RegExp(`\\b${escapeRegExp(word)}\\b`).test(text);
}

/*
  The two guards a Nearby town name passes here and in `story-area.ts`: a court
  named after a town is not the town ("Plymouth Superior Court"), and a town
  written into ANOTHER state is not this one ("Boulder City, Nev."). A town
  written into this paper's own state is still local ("Louisville, Colo."), so
  the own state is left out of the state tokens. Kept here, without an import,
  and exported as `nearbyTownKeepsItLocal` so both callers read one rule.
*/
const COURT_AFTER_TOWN = /^\s+(?:Court|Courthouse|Court House)\b/;

const stateAfterTownPatterns = new Map<string, RegExp>();

/** The dateline state pattern, with `ownState`'s own name and abbreviation left out. */
function stateAfterTown(ownState: string): RegExp {
  const own = stateFor(ownState) ?? stateFor(DEFAULT_STATE);
  const key = own?.name ?? DEFAULT_STATE;
  const cached = stateAfterTownPatterns.get(key);
  if (cached) return cached;
  const tokens = [...new Set(
    STATES.filter((state) => state !== own).flatMap((state) => [state.name, ...state.abbrs]),
  )]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const pattern = new RegExp(`^[^.;]{0,30},\\s*(?:${tokens})(?=\\s|,|;|:|$|\\))`);
  stateAfterTownPatterns.set(key, pattern);
  return pattern;
}

/**
 * Does one occurrence of a Nearby town read as this paper's own town?
 *
 * Shared by `looksOutOfState` above and by `story-area.ts`, which files a story
 * under Nearby. `ownState` is the paper's state (a blank reads as the shipped
 * Colorado); a town followed by a comma and that same state is still local.
 */
export function nearbyTownKeepsItLocal(
  text: string,
  town: string,
  ownState: string = DEFAULT_STATE,
): boolean {
  const name = town.trim();
  if (!name) return false;
  const states = stateAfterTown(ownState);
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const after = text.slice(match.index + match[0].length);
    if (COURT_AFTER_TOWN.test(after)) continue;
    if (states.test(after)) continue;
    return true;
  }
  return false;
}

/**
 * True when `text` writes this state after a comma -- the dateline shape the
 * rule reads (`..., Ky.`, `..., Pennsylvania`). Case-sensitive, so a lowercase
 * word that happens to match an abbreviation is not a state.
 */
function namesStateAfterComma(text: string, state: { name: string; abbrs: readonly string[] }): boolean {
  if (new RegExp(`,\\s*${escapeRegExp(state.name)}\\b`).test(text)) return true;
  return state.abbrs.some((abbr) => {
    const pattern = `,\\s*${escapeRegExp(abbr)}(?=\\s|,|;|:|$|\\))`;
    return new RegExp(pattern).test(text);
  });
}

/** The state row for a name or abbreviation, matched case-insensitively. */
function stateFor(name: string): { name: string; abbrs: readonly string[] } | null {
  const wanted = name.trim().toLowerCase().replace(/\.$/, "");
  if (!wanted) return null;
  const full = STATES.find((state) => state.name.toLowerCase() === wanted);
  if (full) return full;
  return (
    STATES.find((state) =>
      state.abbrs.some((abbr) => abbr.toLowerCase().replace(/\.$/, "") === wanted),
    ) ?? null
  );
}

/**
 * True when the text names a US state other than `ownState` in dateline shape.
 * Exported so the area default and the desk warning read the same rule.
 */
export function namesAnotherState(text: string, ownState: string = DEFAULT_STATE): boolean {
  const own = stateFor(ownState) ?? stateFor(DEFAULT_STATE);
  return STATES.some(
    (state) => state !== own && namesStateAfterComma(text, state),
  );
}

/** True when the text names this particular state in dateline shape. */
function namesThisState(text: string, stateName: string): boolean {
  const state = stateFor(stateName) ?? stateFor(DEFAULT_STATE);
  if (!state) return false;
  if (namesWholeWord(text, state.name)) return true;
  return namesStateAfterComma(text, state);
}

/**
 * Whether this story or lead looks like it is about another state, not this
 * paper's ground.
 *
 * `nearbyTowns` is the paper's own Nearby list (empty for a paper that has
 * none); naming one of them keeps the story local. A blank or missing
 * `place.state` reads as the shipped paper's Colorado.
 */
export function looksOutOfState(
  story: { headline?: string | null; body?: string | null },
  place: { city?: string | null; state?: string | null; county?: string | null },
  nearbyTowns: readonly string[] = [],
): boolean {
  const ownState = (place.state ?? "").trim() || DEFAULT_STATE;
  const text = [story.headline, story.body]
    .map((part) => String(part ?? ""))
    .filter((part) => part.trim().length > 0)
    .join("\n");
  if (!text) return false;
  if (!namesAnotherState(text, ownState)) return false;

  // The story names this paper's own ground somewhere: silence, not a warning.
  if (namesThisState(text, ownState)) return false;
  const city = (place.city ?? "").trim();
  if (city && namesWholeWord(text, city)) return false;
  const county = (place.county ?? "").trim();
  if (county && namesWholeWord(text, `${county} County`)) return false;
  if (nearbyTowns.some((town) => nearbyTownKeepsItLocal(text, town, ownState))) return false;
  return true;
}
