/*
  THE NAMED-OUTLET CHECK (0.6.62).

  A story that says "the Denver Post reported" is making a claim about another
  newsroom's work, and a reader who wants to check it has to be able to get
  there. The story's Sources list is where that happens. When the body names an
  outlet that is not in the sources, the reader is told to trust a report the
  paper has not shown them -- and the desk has no record that anyone looked.

  So printing is refused while an outlet is named and uncovered, unless an
  editor overrides that outlet for that draft, one at a time. The override is
  recorded (editor, time, outlet, draft) and shows on the desk, never on the
  public page: a reader does not need the paper's internal argument, but the
  newsroom needs the paper trail.

  This is the mirror image of source-credit.ts, which asks the opposite
  question ("a source we cite is not credited in the body") and only warns. It
  is deliberately not merged with it: that one is advisory desk UI, this one
  gates publication, and a shared helper would tie a warning to a block.
*/

export type NamedOutlet = {
  /** The name printed to the editor and recorded in the override table. */
  name: string;
  /** Written forms of the name that count as naming it. */
  aliases: string[];
  /** Hosts that count as citing the outlet. */
  domains: string[];
};

/*
  The outlets that cover this town, as the shipped default.

  0.6.63: this is a per-newsroom setting now. A newsroom's own list lives on its
  `paper_settings` row (`named_outlets`, migration 0088), the same nullable
  override-row pattern as every other shipped constant in this app, and it
  falls back to this list field-by-field: a newsroom that never sets it checks
  exactly what it checked before. Every function below takes the list it should
  use, defaulting to this one, because the gate has to judge the draft against
  the newsroom that is printing it.

  The override records in named_outlet_overrides are unchanged: they are keyed
  by newsroom, draft and the outlet's printed name, so an override recorded
  against a list stays valid when the list is edited -- and an outlet that is
  no longer listed simply stops being named by this check.
*/
export const NAMED_OUTLETS: NamedOutlet[] = [
  {
    name: "Longmont Times-Call",
    aliases: ["Times-Call", "Longmont Times-Call", "the Times-Call"],
    domains: ["timescall.com"],
  },
  {
    name: "Longmont Leader",
    aliases: ["Longmont Leader", "the Longmont Leader", "the Leader"],
    domains: ["longmontleader.com"],
  },
  {
    name: "Yellow Scene",
    aliases: ["Yellow Scene", "Yellow Scene Magazine"],
    domains: ["yellowscene.com", "yellowscenemagazine.com"],
  },
  {
    name: "Denver Post",
    aliases: ["Denver Post", "the Denver Post"],
    domains: ["denverpost.com"],
  },
  {
    name: "Colorado Sun",
    aliases: ["Colorado Sun", "the Colorado Sun"],
    domains: ["coloradosun.com"],
  },
  {
    name: "Boulder Daily Camera",
    aliases: ["Daily Camera", "Boulder Daily Camera", "the Daily Camera"],
    domains: ["dailycamera.com"],
  },
  {
    name: "Longmont Observer",
    aliases: ["Longmont Observer", "the Longmont Observer"],
    domains: ["longmontobserver.org"],
  },
];

/** Find a listed outlet by the name an editor used, case insensitive. */
export function namedOutlet(
  name: string,
  outlets: NamedOutlet[] = NAMED_OUTLETS,
): NamedOutlet | null {
  const wanted = normalize(name);
  if (!wanted) return null;
  for (const outlet of outlets) {
    if (normalize(outlet.name) === wanted) return outlet;
    if (outlet.aliases.some((alias) => normalize(alias) === wanted)) return outlet;
  }
  return null;
}

/**
 * Fold a written name to a form that comparisons can use.
 *
 * Markdown emphasis is dropped first: `*Denver Post*` and `_Denver Post_` are
 * how these names are actually written in a story body and both must match.
 * Everything that is not a letter, a digit or a hyphen becomes a space, so
 * punctuation between two names cannot join them -- and the result is padded
 * with spaces so that a match is a whole run of words: "the camera" does not
 * contain " daily camera ".
 *
 * A HYPHEN IS KEPT (0.6.63). It joins words into one name, so keeping it is
 * what stops the ordinary words "at times call" in a sentence from reading as
 * the Longmont Times-Call -- the false positive that made this check refuse a
 * story that named no outlet at all. A hyphen that is not joining a name is
 * still punctuation and goes: a typed dash ("--" or a lone hyphen with spaces
 * around it) and a hyphen at either edge of a word all fold to a space, so
 * "the Times-Call -- reported" and "the -Denver Post" still read as names.
 *
 * The trade is deliberate and one-sided: a body that writes a hyphenated
 * outlet's name WITH A SPACE instead of the hyphen ("Times Call", "Denver
 * Post" for "Denver-Post") is a name this fold no longer sees. A missed outlet
 * costs the reader the source link; a false one refuses a story that did
 * nothing wrong, which is how a gate stops being believed.
 */
function normalize(text: string): string {
  const folded = text
    .replace(/[*_]/g, "")
    .toLowerCase()
    .replace(/-{2,}/g, " ")
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/(^|\s)-+|-+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${folded} `;
}

function names(text: string, outlet: NamedOutlet): boolean {
  const folded = normalize(text);
  if (folded.trim() === "") return false;
  return outlet.aliases.some((alias) => folded.includes(normalize(alias)));
}

/**
 * A stored per-newsroom outlet list, or null when the value is missing or
 * malformed -- the two states that fall back to NAMED_OUTLETS.
 *
 * An EMPTY ARRAY is an answer, not a gap: a newsroom that says it credits no
 * outlets at all is saying so, the same way an empty youtubeChannels says this
 * paper has no meeting video channel (paper-settings.ts). It does mean the
 * named-outlet check never fires for that newsroom, which is a decision an
 * owner has to make on purpose -- not one a typo in a stored value makes.
 * An entry with no name is dropped rather than kept as an outlet called "".
 */
export function asNamedOutlets(raw: unknown): NamedOutlet[] | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const list: NamedOutlet[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<NamedOutlet>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name) continue;
    const listOfStrings = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
        : [];
    const aliases = listOfStrings(candidate.aliases);
    list.push({
      name,
      // An outlet listed by its name alone is named by that name: aliases are
      // the *other* spellings, never the only way to match.
      aliases: aliases.length ? aliases : [name],
      domains: listOfStrings(candidate.domains),
    });
  }
  return list;
}

/** A source URL points at the outlet when its host is the outlet's own. */
function urlIsOutletDomain(url: string, outlet: NamedOutlet): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return false; /* a malformed source URL covers nothing */
  }
  return outlet.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export type OutletCheck = {
  /** The story body as it will print. */
  body: string;
  /** The Sources list as it will print. */
  sourceUrls: string[];
  /** Titles shown for those sources on the page. */
  sourceTitles?: string[];
  /**
   * Outlet names an editor has already overridden for this draft, as recorded
   * in named_outlet_overrides. An override clears that outlet only.
   */
  overridden?: string[];
  /** The newsroom's own outlet list; the shipped list when it has none. */
  outlets?: NamedOutlet[];
};

/**
 * The outlets this draft names in its body and does not show the reader.
 *
 * Ordered as the list it was given so the desk and the refusal read the same
 * way twice, and de-duplicated: a body that names the Camera three times is one
 * outlet to resolve.
 */
export function unresolvedNamedOutlets({
  body,
  sourceUrls,
  sourceTitles = [],
  overridden = [],
  outlets = NAMED_OUTLETS,
}: OutletCheck): string[] {
  const cleared = new Set(
    overridden.map((name) => namedOutlet(name, outlets)?.name ?? normalize(name).trim()),
  );
  const unresolved: string[] = [];
  for (const outlet of outlets) {
    if (cleared.has(outlet.name)) continue;
    if (!names(body, outlet)) continue;
    const covered =
      sourceUrls.some((url) => urlIsOutletDomain(url, outlet)) ||
      sourceTitles.some((title) => names(title, outlet));
    if (!covered) unresolved.push(outlet.name);
  }
  return unresolved;
}

/**
 * The refusal an editor reads when printing stops.
 *
 * It names the outlets, in the story's own language ("names the Denver Post"),
 * and it says what clears it, because the editor's next move is not obvious:
 * the fix is either to add the source or to override it, and both are on the
 * story screen.
 */
export function namedOutletNotice(outlets: string[]): string {
  const list = outlets.join(", ");
  return outlets.length === 1
    ? `This draft names ${list}, and ${list} is not in its Sources. Add the source you read, or open the story and override ${list} for this draft.`
    : `This draft names ${outlets.length} outlets that are not in its Sources: ${list}. Add the sources you read, or open the story and override each one for this draft.`;
}
