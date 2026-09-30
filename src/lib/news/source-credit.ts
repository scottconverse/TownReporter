/** Client-safe source-credit helpers used by the Story workspace and writer. */
export function outletNamesForHost(url: string): string[] {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    if (host.includes("longmontleader")) return ["Longmont Leader", "the Leader"];
    if (host.includes("timescall")) return ["Longmont Times-Call", "Times-Call"];
    if (host.includes("dailycamera")) return ["Daily Camera"];
    if (host.includes("longmontcolorado.gov")) return ["City of Longmont"];
  } catch {
    /* ignore malformed source URLs */
  }
  return [];
}

function spacedWords(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/**
 * The short forms a paper's OWN city is written as (unit U24).
 *
 * THE FALSE WARNING. Publishing warned "The body never names City of Longmont,
 * though it's in the sources" about a story whose body attributes throughout to
 * "the city manager's budget message" and "the city". The outlet list for
 * `longmontcolorado.gov` holds one name -- the full legal phrase -- while the
 * two newspaper hosts beside it hold their short forms too ("Longmont Leader",
 * "the Leader"; "Longmont Times-Call", "Times-Call"). So the official source
 * was the only one that could only be credited by its full name, and a
 * correctly-attributed story was told it had not named its own city.
 *
 * WHY THIS DOES NOT WEAKEN THE CHECK FOR ANYONE ELSE. These aliases are handed
 * out for ONE source: the paper's own city's own site, recognised by
 * `outletNamesForHost` returning exactly `City of <this paper's city>`. A story
 * that names the Longmont Leader or the Denver Post still has to name them --
 * "the city" credits nobody else, and no other outlet gains a synonym.
 *
 * The bare city name is on the list for the same reason "Times-Call" is on the
 * newspaper's: it is how the paper writes its own city, and it is a name, not a
 * pronoun.
 *
 * The first comma-separated part, because the setting is a place ("Longmont,
 * Colorado") and the name is what prose uses.
 */
export function homeCityShortForms(city: string | null | undefined): string[] {
  const name = (city ?? "").split(",")[0]?.trim() ?? "";
  if (!name) return [];
  return [`the city`, `city manager`, `City of ${name}`, name];
}

/**
 * The outlets a body fails to credit, given the URLs its Sources show.
 *
 * `homeCity` is the paper's own city (`PaperIdentity.city`), and it is what
 * turns the short-form list above on for that one source and no other. Absent
 * means no short forms at all, which is the behaviour every caller had before
 * unit U24 -- and what a caller with no paper identity (a script, a test) gets.
 */
export function uncreditedOutlets(
  body: string,
  sourceUrls: string[],
  homeCity?: string | null,
): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  const city = (homeCity ?? "").split(",")[0]?.trim() ?? "";
  const shortForms = homeCityShortForms(homeCity);
  const words = spacedWords(body);
  for (const url of sourceUrls) {
    const names = outletNamesForHost(url);
    if (names.length === 0) continue;
    const primary = names[0]!;
    if (seen.has(primary)) continue;
    /*
      The city's own site, and only it, gets the short forms: `primary` is
      built from the same city name the caller handed us, so a paper in
      Longmont matches "City of Longmont" and a paper anywhere else matches
      nothing here.
    */
    const isHomeCity = Boolean(city) && primary.toLowerCase() === `city of ${city.toLowerCase()}`;
    const accepted = isHomeCity ? [...names, ...shortForms] : names;
    const credited = accepted.some((name) => words.includes(spacedWords(name)));
    seen.add(primary);
    if (!credited) missing.push(primary);
  }
  return missing;
}
