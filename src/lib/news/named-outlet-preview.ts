/*
  WHAT A CHANGE TO THE OUTLET LIST COSTS (0.6.63, Unit W).

  The gate (outlet-credit.ts) refuses to print a story that names an outlet and
  does not show the reader the source. Taking an outlet off the list stops that
  check for every story that names it, and those stories are already published:
  the owner cannot see them on any other screen before they press apply. So the
  editor's preview has to say, in headline and link, exactly which ones.

  Pure, and deliberately so: the diff and the impact are the same computation
  whatever the storage does, and a pure function can be tested against seeded
  stories without a database. The server module (named-outlets.server.ts) reads
  the two lists and the published stories and hands them here.

  It asks the gate's matcher rather than re-implementing it. A second opinion
  about what counts as naming an outlet is how a preview ends up promising an
  impact that the gate does not deliver, or missing one it does.
*/

import {
  outletNameKey,
  unresolvedNamedOutlets,
  type NamedOutlet,
} from "./outlet-credit.ts";

/** How many stories a change may list before it says "and N more". */
export const IMPACT_STORY_CAP = 20;

export type PublishedStory = {
  id: number;
  headline: string;
  slug: string;
  body: string;
  /** The story's printed Sources list, exactly as the gate reads it. */
  sourceUrls: string[];
};

export type ImpactStory = { id: number; headline: string; slug: string; url: string };

export type NamedOutletChange = {
  kind: "added" | "removed" | "changed";
  /** The name to show: the row's name after the change, or before a removal. */
  name: string;
  before: NamedOutlet | null;
  after: NamedOutlet | null;
  /**
   * The written forms that stop counting for this outlet -- every alias of a
   * removed outlet, or the aliases a change drops. Empty means nothing the
   * gate matches with went away.
   */
  droppedAliases: string[];
  /** The published stories whose credit this change drops, newest first. */
  stories: ImpactStory[];
  /** All of them, so the screen can say "and 12 more". */
  storyCount: number;
};

const foldSet = (list: readonly string[]): string[] => list.map(outletNameKey).sort();

function sameFoldSet(a: readonly string[], b: readonly string[]): boolean {
  const left = foldSet(a);
  const right = foldSet(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** The same outlet row, matched the way the gate matches: by folded name. */
function sameRow(before: NamedOutlet, after: NamedOutlet): boolean {
  return (
    outletNameKey(before.name) === outletNameKey(after.name) &&
    sameFoldSet(before.aliases, after.aliases) &&
    sameFoldSet(before.domains, after.domains)
  );
}

function aliasesLost(before: NamedOutlet, after: NamedOutlet): string[] {
  const kept = new Set(after.aliases.map(outletNameKey));
  const lost: string[] = [];
  const seen = new Set<string>();
  for (const alias of before.aliases) {
    const key = outletNameKey(alias);
    if (!key || kept.has(key) || seen.has(key)) continue;
    seen.add(key);
    lost.push(alias);
  }
  return lost;
}

/**
 * The published stories whose credit the gate stops checking when this outlet
 * is judged by `aliases` instead of by its full alias list.
 *
 * The story's own Sources are passed in, so a story that already shows the
 * reader the source is not reported as affected -- the gate does not refuse
 * that story today and stops refusing nothing tomorrow. Domains are not part
 * of a removal or an alias change on purpose: taking a domain off the list
 * makes the gate STRICTER (a source URL stops counting as covering), so it can
 * never cost a story its credit.
 */
function impact(
  aliases: readonly string[],
  name: string,
  stories: readonly PublishedStory[],
): { stories: ImpactStory[]; storyCount: number } {
  const outlet: NamedOutlet = {
    name,
    aliases: aliases.length ? [...aliases] : [name],
    domains: [],
  };
  const hit = stories.filter(
    (story) =>
      unresolvedNamedOutlets({
        body: story.body,
        sourceUrls: story.sourceUrls,
        outlets: [outlet],
      }).length > 0,
  );
  return {
    stories: hit.slice(0, IMPACT_STORY_CAP).map((story) => ({
      id: story.id,
      headline: story.headline,
      slug: story.slug,
      url: `/articles/${story.slug}`,
    })),
    storyCount: hit.length,
  };
}

/**
 * The difference between the list the gate is using now and the list the owner
 * is about to apply, in the order the preview reads: what is added, what is
 * removed, then what changed.
 *
 * Both lists are expected as the gate will read them (cleaned, aliases
 * defaulted) -- apply() cleans before storing, so a change the owner can see
 * here is a change they will get.
 */
export function namedOutletPreview(
  saved: readonly NamedOutlet[],
  draft: readonly NamedOutlet[],
  stories: readonly PublishedStory[] = [],
): NamedOutletChange[] {
  const savedByKey = new Map(saved.map((outlet) => [outletNameKey(outlet.name), outlet]));
  const draftByKey = new Map(draft.map((outlet) => [outletNameKey(outlet.name), outlet]));

  const added: NamedOutletChange[] = [];
  const changed: NamedOutletChange[] = [];
  const removed: NamedOutletChange[] = [];

  for (const outlet of draft) {
    const before = savedByKey.get(outletNameKey(outlet.name));
    if (!before) {
      added.push({
        kind: "added",
        name: outlet.name,
        before: null,
        after: outlet,
        droppedAliases: [],
        stories: [],
        storyCount: 0,
      });
      continue;
    }
    if (sameRow(before, outlet)) continue;
    const lost = aliasesLost(before, outlet);
    changed.push({
      kind: "changed",
      name: outlet.name,
      before,
      after: outlet,
      droppedAliases: lost,
      ...(lost.length ? impact(lost, outlet.name, stories) : { stories: [], storyCount: 0 }),
    });
  }

  for (const outlet of saved) {
    if (draftByKey.has(outletNameKey(outlet.name))) continue;
    removed.push({
      kind: "removed",
      name: outlet.name,
      before: outlet,
      after: null,
      droppedAliases: [...outlet.aliases],
      ...impact(outlet.aliases, outlet.name, stories),
    });
  }

  return [...added, ...removed, ...changed];
}
