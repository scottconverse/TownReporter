/*
  The Server screen's twelve cards, as the drawing draws them (0.6.81, unit CX2).

  Desk Screens.dc.html, `isServer`, draws `/desk/ops` as ONE two-column grid of
  summary cards: each card carries two to five label/value rows and one or two
  buttons, and nothing else. Before this unit every card carried its full editor
  open inside it -- eighteen thousand pixels of page at 1440 wide, against a
  drawing that fits in a screen and a half.

  This module is the one place that says what the twelve cards ARE: their drawn
  titles, the order they appear in, which column each one falls in, which of
  them only the owner may read, the rows each one shows, and the buttons at its
  foot. Both halves of the pattern read it:

    - `src/routes/desk.ops.tsx` draws the summary -- rows and buttons.
    - `src/routes/desk.ops_.$card.tsx` is the screen each button opens, and
      takes its title, its anchor id and its read-only sentence from here.

  The row LABELS live here and the row VALUES are read in the page, from the
  same server reads the editors behind these buttons already used, so a summary
  can never advertise a row the editor does not have. A row whose value does
  not exist on this machine reads "Not set"; `drawnRowsWithoutARead` below is
  the list of those, named in the unit's report rather than quietly dropped.

  The order is the drawing's, verbatim:

    left  column: Writing models (tall), Recently deleted, Daily scan, YouTube,
                  Named outlets, Time budgets
    right column: Health, Paper setup, Sections, Meeting capture,
                  Routine notices, Editors & access

  It is written as one flat list in drawn reading order, with `tall` on Writing
  models: the page renders the flat list into the two-column grid, so the order
  here and the order on the screen are the same list and cannot drift.
*/

export type OpsCardKey =
  | "writing-models"
  | "health"
  | "paper-setup"
  | "recently-deleted"
  | "sections"
  | "daily-scan"
  | "meeting-capture"
  | "youtube"
  | "routine-notices"
  | "named-outlets"
  | "editors-access"
  | "time-budgets";

/** One button at the foot of a card. */
export type OpsCardDoor = {
  /** The drawing's own words for the button. */
  label: string;
  /**
   * `solid` is the drawn yellow button; `plain` is the drawn outline. The
   * drawing fills exactly one button on this screen -- `Assign models to jobs →`
   * -- and draws every card button as the outline (`Desk Screens.dc.html:326`,
   * where `small` is the border-only style and `smallP`, the filled one, is
   * used by another screen's rows and by no card here).
   */
  tone: "solid" | "plain";
  /** Another card's screen, when the button opens an editor on this page. */
  card?: OpsCardKey;
  /** A screen of its own, when the button leaves the Server page. */
  href?: "/desk/models";
  search?: { tab: string };
};

export type OpsCardDef = {
  key: OpsCardKey;
  /** The URL segment: `/desk/ops/<slug>` opens this card's editor. */
  slug: string;
  /**
   * The id the card carries on the summary page AND on its own screen, so the
   * bookmarks and the walks that scroll to `#ops-panel-<x>` keep landing on the
   * same card now that the card has two homes.
   */
  anchor: string;
  /** The drawn title -- the short one, as the drawing prints it. */
  title: string;
  /** The drawing's half-line under the title, or the sentence explaining it. */
  sub: string;
  /** The panel's own heading, where the drawn short name differs from it. */
  panelTitle: string;
  /** Only the owner may read the rows; an editor gets `editorNote`. */
  ownerOnly: boolean;
  /** The drawing's `grid-row:span 2` -- Writing models, and only it. */
  tall?: boolean;
  /**
   * The exact label/value rows the drawing draws, top to bottom. Writing models
   * is the one card with none: the drawing prints its ladder as numbered rows
   * with no labels at all, so its rows are the ladder's own rungs.
   */
  rows: readonly string[];
  doors: readonly OpsCardDoor[];
  /** What an editor who is not the owner reads instead of the rows. */
  editorNote: string;
};

export const OPS_CARDS: readonly OpsCardDef[] = [
  {
    key: "writing-models",
    slug: "writing-models",
    anchor: "ops-panel-writing-models",
    title: "Writing models",
    panelTitle: "Writing models",
    sub: "Every place the desk writes uses this list. Automatic tries them in this order.",
    ownerOnly: false,
    tall: true,
    rows: [],
    doors: [
      { label: "Assign models to jobs →", tone: "solid", href: "/desk/models" },
      { label: "All connections", tone: "plain", href: "/desk/models", search: { tab: "conn" } },
    ],
    editorNote:
      "Only the owner can see which writing models this machine is signed in to, and can sign one back in. Both buttons below open the same lists; they will say what is yours to change and what is not.",
  },
  {
    key: "health",
    slug: "health",
    anchor: "ops-panel-server-health",
    title: "Health",
    panelTitle: "Health",
    sub: "What answers from this machine right now. Checks show what responds here; they do not prove that a reader in another town can reach your paper.",
    ownerOnly: true,
    rows: ["Database", "Disk", "Last backup", "Errors in 24 h"],
    doors: [
      { label: "View logs", tone: "plain", card: "health" },
      { label: "Restart workers", tone: "plain", card: "health" },
    ],
    editorNote:
      "Only the owner can read this machine’s health, its logs and the buttons that restart things. Ask the owner if a check looks wrong.",
  },
  {
    key: "paper-setup",
    slug: "paper-setup",
    anchor: "ops-panel-paper-identity",
    title: "Paper setup",
    panelTitle: "Paper setup",
    sub: "The paper’s name, town and starting watch list, as the reader sees them.",
    ownerOnly: true,
    rows: ["Name", "Town", "Editor email", "Sections"],
    doors: [
      { label: "Edit setup", tone: "plain", card: "paper-setup" },
      { label: "Invite an editor", tone: "plain", card: "editors-access" },
    ],
    editorNote:
      "Only the owner can change the paper’s name, town, state, timezone and starting watch list.",
  },
  {
    key: "recently-deleted",
    slug: "recently-deleted",
    anchor: "ops-panel-recently-deleted",
    title: "Recently deleted",
    panelTitle: "Recently deleted",
    sub: "Everything deleted from the desk waits here before it goes for good.",
    ownerOnly: false,
    rows: ["Drafts", "Killed leads"],
    doors: [{ label: "Open trash", tone: "plain", card: "recently-deleted" }],
    editorNote: "",
  },
  {
    key: "sections",
    slug: "sections",
    anchor: "ops-panel-sections",
    title: "Sections",
    panelTitle: "Newspaper sections",
    sub: "The rail on every desk page and the headings on the public paper.",
    ownerOnly: true,
    rows: ["Visible", "Hidden or retired"],
    doors: [{ label: "Edit sections", tone: "plain", card: "sections" }],
    editorNote:
      "Only the owner can add, rename, hide or retire a section. The sections themselves are the rail on every desk page and the headings on the public paper.",
  },
  {
    key: "daily-scan",
    slug: "daily-scan",
    anchor: "ops-panel-daily-scan",
    title: "Daily scan",
    panelTitle: "Daily scan",
    sub: "A scheduled reporter pass for leads only. It does not draft or publish anything.",
    ownerOnly: true,
    rows: ["Runs", "Files up to"],
    doors: [{ label: "Scan settings", tone: "plain", card: "daily-scan" }],
    editorNote:
      "Only the owner can change when the daily scan runs and how much it may read. It runs for the whole paper, once.",
  },
  {
    key: "meeting-capture",
    slug: "meeting-capture",
    anchor: "ops-panel-meeting-capture",
    title: "Meeting capture",
    panelTitle: "Meeting capture",
    sub: "Public meetings the desk records and turns into transcripts.",
    ownerOnly: true,
    rows: ["Bodies watched", "Last capture"],
    doors: [{ label: "Capture settings", tone: "plain", card: "meeting-capture" }],
    editorNote:
      "Only the owner can configure meeting capture. The card is here so the page still says what the desk watches.",
  },
  {
    key: "youtube",
    slug: "youtube",
    anchor: "ops-panel-youtube",
    title: "YouTube",
    panelTitle: "YouTube key",
    sub: "Whether the desk reads YouTube through Google’s official service.",
    ownerOnly: false,
    rows: ["API key", "Transcripts"],
    doors: [{ label: "Replace key", tone: "plain", card: "youtube" }],
    editorNote: "",
  },
  {
    key: "routine-notices",
    slug: "routine-notices",
    anchor: "ops-panel-routine-notices",
    title: "Routine notices",
    panelTitle: "Routine notice permissions",
    sub: "The kinds of notice the desk may handle without an editor’s approval.",
    ownerOnly: true,
    rows: ["Handled automatically", "Last run"],
    doors: [{ label: "Notice rules", tone: "plain", card: "routine-notices" }],
    editorNote:
      "Only the owner can see or change which notice kinds the desk handles on its own. The rules the owner sets stand for everyone.",
  },
  {
    key: "named-outlets",
    slug: "named-outlets",
    anchor: "ops-panel-named-outlets",
    title: "Named outlets",
    panelTitle: "Named outlets",
    sub: "The outlets a story must credit, and the ones you have overridden.",
    ownerOnly: true,
    rows: ["Outlets", "Overrides"],
    doors: [{ label: "Edit outlets", tone: "plain", card: "named-outlets" }],
    editorNote:
      "Only the owner can change the named outlets and their overrides. Everything the desk writes still uses them.",
  },
  {
    key: "editors-access",
    slug: "editors-access",
    anchor: "ops-panel-editors-access",
    title: "Editors & access",
    panelTitle: "Invite an editor",
    sub: "Who else can write for this paper, and the link that adds another.",
    /*
      Owner-only because of the "Owner" row, not because of the button. Both
      rows are owner-only reads (`readNewsroomAccess`, and the invite count),
      and a reader who may not have them would read "Not set" where the desk
      does have a value and simply will not show it. The door stays open to
      everyone: an editor needs it to hand the newsroom back
      (LeaveEditorControl), which is why the note below promises exactly that.
    */
    ownerOnly: true,
    rows: ["Owner", "Invites open"],
    doors: [{ label: "Invite an editor", tone: "plain", card: "editors-access" }],
    editorNote:
      "Only the owner can invite an editor or hand the newsroom over. “Invite an editor” still opens the screen, where your own way out is.",
  },
  {
    key: "time-budgets",
    slug: "time-budgets",
    anchor: "ops-panel-time-budgets",
    title: "Time budgets",
    panelTitle: "Time budgets",
    sub: "How long one answer from each model may take before the desk gives up on it.",
    ownerOnly: true,
    rows: ["Local models", "Subscription CLIs"],
    doors: [{ label: "Adjust times", tone: "plain", card: "time-budgets" }],
    editorNote:
      "Only the owner can read or change how long one answer from each model may take. The limits the owner sets stand for everyone, so the desk still gives up on an answer at the same moment on your screen and theirs.",
  },
];

export function opsCard(key: OpsCardKey): OpsCardDef {
  const found = OPS_CARDS.find((card) => card.key === key);
  /* Unreachable while every door names a key in the list above. */
  if (!found) throw new Error(`No Server card named ${key}`);
  return found;
}

/** The card a URL segment names, or undefined for a segment nobody drew. */
export function opsCardBySlug(slug: string): OpsCardDef | undefined {
  return OPS_CARDS.find((card) => card.slug === slug);
}

/**
 * The drawn rows with no reading behind them on this machine.
 *
 * The drawing draws every card from one afternoon on one machine. One of its
 * rows names a fact this app does not store at all: YouTube's "Transcripts".
 * It renders the plain "Not set" and is named here, and in the unit's report,
 * instead of being filled with a number that would be invented or a row that
 * would silently disappear from a card the drawing gives two rows.
 *
 * Five others were on this list until unit CX3 (0.6.81) found the source each
 * one already had and wired it: "Last backup" reads the backup's own state file
 * (ops/lib-backup.ps1 -> logs/backup-state.json), "Errors in 24 h" counts
 * failed desk jobs over the last day, "Last capture" reads the capture record's
 * own `captured_at`, "Overrides" counts this paper's append-only override rows,
 * and "Invites open" counts the live invite links. A row that says "Not set"
 * about a fact the desk has written down is worse than a missing read: it looks
 * like an answer. The old `why` on the backup row was the failure mode this
 * note now guards against -- a grep over `src/` reported as a fact about the
 * machine, when the answer was in `ops/` the whole time.
 *
 * Each `why` names the probe that settled it, because "this app has no such
 * read" is a claim about the source, not about the drawing, and it has to be
 * checkable the same way.
 */
export const DRAWN_ROWS_WITHOUT_A_READ: readonly { card: OpsCardKey; row: string; why: string }[] = [
  {
    card: "youtube",
    row: "Transcripts",
    why: "No YouTube transcript is stored to read back: every transcript table in migrations/ is a meeting table (0069, 0070, 0078-0085), the YouTube read's own type (youtube-data-api.server.ts:446, YouTubeKeyState) carries hasKey / source / wording / unitsToday / unitsLimit / quotaBlockedToday and no transcript field, and the Test button's answer is component state (youtube-key.tsx:52, useState) that is gone when the page is.",
  },
];
