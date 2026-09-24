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
  The outlets that cover this town, as a constant rather than a per-newsroom
  setting.

  TODO(0.6.63): make this a per-newsroom list. It should be, and it is not:
  every other configurable surface in this app (sections, sources, scan
  policies) reads from a table keyed by newsroom_id through the settings
  pattern, and copying that pattern for one list is a schema, a settings UI, a
  loader and a migration -- not the small change this fix is. The list is a
  constant so that the check can ship, and the newsroom_id column below is
  already there so that the override records survive the move.
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
export function namedOutlet(name: string): NamedOutlet | null {
  const wanted = normalize(name);
  if (!wanted) return null;
  for (const outlet of NAMED_OUTLETS) {
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
 * Everything that is not a letter or a digit becomes a space, so punctuation
 * between two names cannot join them -- and a hyphen inside one (`Times-Call`)
 * does not split it. The result is padded with spaces so that a match is a
 * whole run of words: "the camera" does not contain " daily camera ".
 */
function normalize(text: string): string {
  return ` ${text
    .replace(/[*_]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function names(text: string, outlet: NamedOutlet): boolean {
  const folded = normalize(text);
  if (folded.trim() === "") return false;
  return outlet.aliases.some((alias) => folded.includes(normalize(alias)));
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
};

/**
 * The outlets this draft names in its body and does not show the reader.
 *
 * Ordered as NAMED_OUTLETS so the desk and the refusal read the same way twice,
 * and de-duplicated: a body that names the Camera three times is one outlet to
 * resolve.
 */
export function unresolvedNamedOutlets({
  body,
  sourceUrls,
  sourceTitles = [],
  overridden = [],
}: OutletCheck): string[] {
  const cleared = new Set(
    overridden.map((name) => namedOutlet(name)?.name ?? normalize(name).trim()),
  );
  const unresolved: string[] = [];
  for (const outlet of NAMED_OUTLETS) {
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
