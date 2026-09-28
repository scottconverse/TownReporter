/*
  One Server card's own screen: `/desk/ops/<card>`.

  Unit CX2 item 2: the summary page draws each card as a summary -- rows and
  buttons -- and every one of those buttons opens the existing editor for that
  card. There are two ways to do that (a dialog, or a sub-route with a back
  link) and this is the sub-route, chosen once and used for all twelve, because
  it is the one the desk already knows how to walk: the editors are ordinary
  components on an ordinary route, the back link is the desk's own crumb, and
  nothing has to be lifted into a modal that no screen in this build uses yet
  (`src/components/dialog.tsx` exists, and `scripts/astra-dialog-e2e.mjs` still
  says no screen opens it).

  The screen is deliberately thin. It draws a crumb, the card's drawn half-line,
  and then the editor -- which brings its own heading, its own section and its
  own ids, unchanged from the page these panels were lifted off. Two things are
  NOT drawn here, both on purpose:

    - No heading of its own. `HealthPanel` already draws `<h2>Health</h2>`, and
      `scripts/desk-flows-e2e.mjs` opens `/desk/ops/recently-deleted` and waits
      for the one heading matching "Recently deleted" -- a second heading
      carrying the same words is a strict-mode violation, and the panel's own
      heading IS this screen's heading.
    - No `<section>` wrapper. The panels already carry `section[aria-label=...]`
      and `<section>` + heading pairs the walks and the axe pass look for, and a
      second section with the same name would match twice. The card's anchor id
      rides on a plain `<div>`, so `#ops-panel-<x>` still lands on the same card
      now that the card has two homes.

  The card's doors are drawn here too, minus the one that leads back to this
  screen (`ops-cards.ts` gives most cards exactly that one). What is left is the
  door that goes somewhere else -- Writing models' two buttons onto the Models
  screen, Paper setup's "Invite an editor" -- so the screen behind a card is not
  a dead end.
*/

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DeskShell } from "@/components/desk-chrome";
import { ListSkeleton } from "@/components/states";
import {
  CardDoor,
  GiveUpTheDesk,
  HealthPanel,
  InviteAnEditorPanel,
  PaperSetupPanel,
  RecentlyDeletedPanel,
  ReadOnlyCard,
  RecoveryCodesPanel,
  TimeBudgets,
  WritingModelsPanel,
} from "@/components/ops-panels";
import { DailyScanSettings } from "@/components/daily-scan-settings";
import { MeetingCaptureSettings } from "@/components/meeting-capture-settings";
import { NamedOutletsSetup } from "@/components/named-outlets-setup";
import { RoutineNoticePermissions } from "@/components/routine-notice-permissions";
import { SectionsSetup } from "@/components/sections-setup";
import { YoutubeKeySettings } from "@/components/youtube-key";
import { opsCardBySlug, type OpsCardKey } from "@/lib/desk/ops-cards";
import { myDesk } from "@/lib/news/claim";

export const Route = createFileRoute("/desk/ops_/$card")({
  head: () => ({ meta: [{ title: "Server — TownReporter" }] }),
  /*
    `?signin=claude` arrives here now, not on `/desk/ops`: the sign-in control
    it belongs to is on the Writing models screen, so that is where the button
    on a failed draft sends the editor (provider-signin-button.tsx). The param
    is still validated rather than trusted -- it decides what the screen scrolls
    to and announces -- and the same three lines as the overview's, so the two
    screens cannot disagree about what the slot may hold.
  */
  validateSearch: (search: Record<string, unknown>): { signin?: "claude" | "codex" } => ({
    signin: search.signin === "claude" || search.signin === "codex" ? search.signin : undefined,
  }),
  component: OpsCardScreen,
});

/**
 * The editor each card's door opens.
 *
 * A `Record` over the card keys rather than a switch, so the twelve are
 * exhaustive by construction: adding a card to `ops-cards.ts` without deciding
 * what its screen shows is a type error, not a blank page.
 *
 * Three of these have their whole body in `ops-panels.tsx` already
 * (`HealthPanel`, `PaperSetupPanel`, `RecentlyDeletedPanel`, `WritingModelsPanel`,
 * `TimeBudgets`); six are the shipped settings panels, rendered here once each.
 * `editors-access` draws all three in the order the old Server page had them:
 * the invite form, which is the owner's half and returns null for anyone else;
 * the owner's recovery codes (Unit CJ, which also return null for anyone
 * else); and "Give up the desk", which is everyone's -- an editor's way out of
 * a newsroom must not be behind an owner-only form.
 */
const CARD_EDITORS: Record<
  OpsCardKey,
  (p: { isOwner: boolean; known: boolean; signin?: "claude" | "codex" }) => React.ReactNode
> = {
  "writing-models": (p) => (
    <WritingModelsPanel isOwner={p.isOwner} known={p.known} signin={p.signin} />
  ),
  health: () => <HealthPanel />,
  "paper-setup": () => <PaperSetupPanel />,
  "recently-deleted": () => <RecentlyDeletedPanel />,
  sections: () => <SectionsSetup />,
  "daily-scan": () => <DailyScanSettings />,
  "meeting-capture": () => <MeetingCaptureSettings />,
  youtube: () => <YoutubeKeySettings />,
  "routine-notices": () => <RoutineNoticePermissions />,
  "named-outlets": () => <NamedOutletsSetup />,
  "editors-access": () => (
    <>
      <InviteAnEditorPanel />
      <RecoveryCodesPanel />
      <GiveUpTheDesk />
    </>
  ),
  "time-budgets": () => <TimeBudgets />,
};

function OpsCardScreen() {
  const { card: slug } = Route.useParams();
  const { signin } = Route.useSearch();
  const card = opsCardBySlug(slug);

  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const known = me.isSuccess;
  const isOwner = me.data?.role === "owner";

  /*
    A segment nobody drew. It can only arrive from the address bar -- every door
    on the summary names a slug out of `OPS_CARDS` -- so it says so and offers
    the way back rather than rendering an empty shell.
  */
  if (!card) {
    return (
      <DeskShell title="Server" kicker="Models, health and setup" hideTitle>
        <p className="crumb">
          <Link to="/desk/ops" className="inline-link">
            ← Server
          </Link>
        </p>
        <p className="lede">
          There is no card called “{slug}” on the Server page. The address may be out of date, or a
          letter may be missing from it.
        </p>
      </DeskShell>
    );
  }

  /*
    A reader who may not have this card's rows gets the card's own sentence
    instead of the editor -- except on Editors & access, where the point of the
    screen is the editor's own way out. `known` gates it: while nobody yet knows
    who is reading, a skeleton, because the sentence for an editor shown to the
    owner for a tenth of a second is a lie the page tells about itself.
  */
  const refused = known && !isOwner && card.ownerOnly && card.key !== "editors-access";

  /* Every door but the one that leads back here. Most cards have exactly that
     one, so most screens draw no buttons of their own. */
  const elsewhere = card.doors.filter((door) => door.href || door.card !== card.key);

  return (
    <DeskShell title="Server" kicker={card.title} hideTitle>
      <p className="crumb">
        <Link to="/desk/ops" className="inline-link">
          ← Server
        </Link>
      </p>
      <p className="lede">{card.sub}</p>
      <div id={card.anchor} className="astra-jump">
        {!known ? (
          <ListSkeleton rows={3} />
        ) : refused ? (
          <ReadOnlyCard title={card.title}>{card.editorNote}</ReadOnlyCard>
        ) : (
          CARD_EDITORS[card.key]({ isOwner, known, signin })
        )}
      </div>
      {elsewhere.length ? (
        <div className="mt-10 flex flex-wrap gap-2">
          {elsewhere.map((door) => (
            <CardDoor key={door.label} door={door} />
          ))}
        </div>
      ) : null}
    </DeskShell>
  );
}
