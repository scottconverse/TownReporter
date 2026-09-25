/*
  The owner-facing words of the Named outlets panel (0.6.63, Unit W).

  Kept beside sections-setup-copy.ts and for the same reason: the sentences are
  the feature -- "3 published stories credit Times-Call. After this change the
  paper will no longer check that credit." is the only thing standing between
  an owner and a silent loss of the check for a thousand stories -- and copy in
  a pure module can be asserted without a DOM or a browser.
*/

/** The sticky bar's live message while a draft exists (unsaved-changes-guard). */
export const UNSAVED_OUTLETS_BAR_MESSAGE = "You have unsaved outlet list changes";
export const OUTLETS_BAR_LABEL = "Named outlet changes not saved";
export const OUTLETS_LEAVE_LABEL = "Leave with unsaved outlet changes?";

/** The three stored states, each said as a fact about the paper. */
export function builtInLabel(count: number): string {
  return `Using the built-in list (${count} ${count === 1 ? "outlet" : "outlets"})`;
}

export const NONE_LABEL = "This paper checks no outlet names";

/**
 * The warning under NONE_LABEL. It says what stops happening and what still
 * can, because "the paper checks nothing" reads like a safe default and it is
 * not one: it is the one setting here that can only lose the paper a check.
 */
export const NONE_WARNING =
  "Printing no longer stops when a story names another newsroom's work and does not show the reader that source. An editor can still add the source by hand.";

export function ownListLabel(count: number): string {
  return `This paper checks ${count} ${count === 1 ? "outlet" : "outlets"}`;
}

export const SHIPPED_LIST_NOTE =
  "These are the outlets the paper shipped with. Customize to add, remove or rename one.";

export const OWN_LIST_NOTE =
  "A story that names one of these outlets has to show the reader the source, unless an editor overrides that outlet for that draft.";

/** The sentence that carries the whole preview. */
export function impactSentence(name: string, count: number): string {
  const stories = count === 1 ? "1 published story credits" : `${count} published stories credit`;
  return `${stories} ${name}. After this change the paper will no longer check that credit.`;
}

export function moreStoriesLabel(count: number): string {
  return count === 1 ? "and 1 more published story" : `and ${count} more published stories`;
}

export const NO_IMPACT_NOTE = "No published story credits a name this change stops checking.";

export const DOMAIN_ONLY_NOTE =
  "A domain only decides what counts as showing the source. Changing one never stops the paper checking a story.";

export const EMPTY_PREVIEW_NOTE = "This list is identical to the one the paper is using now.";

export const APPLY_FAILED_NOTE =
  "Unable to apply the outlet list. Nothing has been changed.";

/** The panel's own labels and hints, here so the walk finds the same words. */
export const PANEL_INTRO =
  "The outlets this paper checks by name. A published story that names one of them has to show the reader the source; if it does not, printing stops until an editor adds the source or overrides that outlet for that draft.";

export const CUSTOMIZE_LABEL = "Customize";
export const ADD_OUTLET_LABEL = "Add outlet";
export const USE_BUILT_IN_LABEL = "Use the built-in list";
export const CHECK_NONE_LABEL = "Check no outlet names";
export const ALIAS_HINT =
  "Separate aliases with commas. A story that names any of them has to show the reader the source.";
export const DOMAIN_HINT =
  "Write the domain alone, like denverpost.com. Leave it empty if the outlet has no website.";
export const SAVED_MESSAGE = "Outlets saved. The paper now checks this list.";
export const READ_ONLY_NOTE = "Only the owner can change which outlets the paper checks.";
export const REVIEW_FAILED_NOTE = "Unable to review the change. Nothing has been changed.";
