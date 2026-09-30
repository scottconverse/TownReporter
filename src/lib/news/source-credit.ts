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
 * The words a paper's OWN city is called, without its name (units U24, U24b).
 *
 * THE FALSE WARNING U24 FIXED. Publishing warned "The body never names City of
 * Longmont, though it's in the sources" about a story whose body attributes
 * throughout to "the city manager's budget message" and "the city". The outlet
 * list for `longmontcolorado.gov` held one name -- the full legal phrase --
 * while the two newspaper hosts beside it held their short forms too, so the
 * official source was the only one that could ONLY be credited by its full
 * name.
 *
 * THE LOOSENESS U24b TOOK BACK. U24's list also carried the bare city name and
 * a bare "the city", which credited the city's own site for a body saying
 * "Longmont Leader" (the newspaper's name, not the city's) or "the city of
 * Boulder" (somebody else's). Neither is the paper crediting its own city. What
 * is left is the three phrases prose actually uses for the place it publishes
 * in, and each is checked against the "of <somewhere else>" rule below.
 *
 * THE CITY NAME IS NOT ON THIS LIST, deliberately. "City of <name>" is already
 * an alias (`outletNamesForHost`), which is the form a story prints when it
 * means the government; the bare name is a name that other names contain.
 */
export function homeCityWords(): string[] {
  return ["the city", "city manager", "city council"];
}

/** Escape a city name so it can sit in a regular expression literally. */
function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does the body name the paper's own city in prose's own words? (Unit U24b.)
 *
 * The rule the brief states, in one place: "the city", "city manager" and "city
 * council" credit the paper's own city's site -- UNLESS the phrase is naming
 * somewhere else, which is the "of <another place>" tail. "the city of Boulder"
 * is Boulder's manager, Boulder's council and Boulder's city, and it must not
 * stand in for Longmont's.
 *
 * The comparison runs on `spacedWords`, so "the city's budget" and "the City
 * Council voted" normalize into the same shape prose does. "the city of
 * Longmont" is not a special case here: it is credited by the full alias
 * "City of Longmont", which `outletNamesForHost` already carries.
 */
function creditsHomeCity(words: string, city: string): boolean {
  const own = city.toLowerCase();
  /*
    Remove every "<phrase> of <somewhere else>" run before asking, so a body
    that says "the city of Boulder" cannot leave a bare " the city " behind. A
    place named after us is left alone -- that one is ours.
  */
  const elsewhere = new RegExp(
    `\\s(?:${homeCityWords().join("|")})\\sof\\s+(?!${escapeForRegex(own)}(?:\\s|$))[a-z0-9]+`,
    "g",
  );
  const ours = words.replace(elsewhere, " ");
  return homeCityWords().some((phrase) => ours.includes(` ${phrase} `));
}

/**
 * The outlets a body fails to credit, given the URLs its Sources show.
 *
 * `homeCity` is the paper's own city (`PaperIdentity.city`). It is what turns
 * the words above on for ONE source -- the city's own site, recognised by
 * `outletNamesForHost` returning exactly `City of <this paper's city>` -- and
 * for no other. A story that names the Longmont Leader or the Denver Post still
 * has to name them.
 *
 * The city setting is a place ("Longmont, Colorado"); the name is the first
 * comma-separated part.
 *
 * Absent means no short forms at all, which is the behaviour every caller had
 * before unit U24 -- and what a caller with no paper identity (a script, a
 * test) gets.
 */
export function uncreditedOutlets(
  body: string,
  sourceUrls: string[],
  homeCity?: string | null,
): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  const city = (homeCity ?? "").split(",")[0]?.trim() ?? "";
  const words = spacedWords(body);
  for (const url of sourceUrls) {
    const names = outletNamesForHost(url);
    if (names.length === 0) continue;
    const primary = names[0]!;
    if (seen.has(primary)) continue;
    /*
      The city's own site, and only it, gets the prose words: `primary` is built
      from the same city name the caller handed us, so a paper in Longmont
      matches "City of Longmont" and a paper anywhere else matches nothing here.
    */
    const isHomeCity = Boolean(city) && primary.toLowerCase() === `city of ${city.toLowerCase()}`;
    const credited =
      names.some((name) => words.includes(spacedWords(name))) ||
      (isHomeCity && creditsHomeCity(words, city));
    seen.add(primary);
    if (!credited) missing.push(primary);
  }
  return missing;
}
