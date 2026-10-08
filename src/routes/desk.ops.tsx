/*
  The Server screen: the drawing's twelve summary cards, and nothing else.

  Desk Screens.dc.html, `isServer`, draws `/desk/ops` as ONE two-column grid of
  SUMMARY cards -- two to five label/value rows and one or two buttons each.
  Unit CX2 audited the built page against it at 1440 wide: the same twelve cards
  in the same order, every one of them carrying its whole editor open inside it,
  which made the page eighteen thousand pixels tall against a drawing that fits
  in one and a half screens. This file is the drawing.

  What each card SAYS lives in `src/lib/desk/ops-cards.ts` (the drawn titles,
  rows and buttons, in the drawn order) and `src/lib/desk/ops-rows.ts` (the
  values, turned from the real reads). This file only draws it, so a card and
  its editor cannot disagree: they read the same module for the labels and the
  same server reads, under the same query keys, for the numbers.

  Every button on every card is a DOOR to that card's own screen,
  `/desk/ops/<card>` (`src/routes/desk.ops_.$card.tsx`), which renders the same
  editor component that used to be open here. So every control that worked
  before still works, one click and a back link away, and the screen behind a
  card is the only place the editor lives -- one pattern for all twelve, as the
  unit asks. The two Writing models buttons are the drawing's own exception:
  they leave for the Models screen, which is where those two lists are.
*/

import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { DeskShell } from "@/components/desk-chrome";
import { ListSkeleton } from "@/components/states";
import { CardDoor, OpsCard, ReadOnlyNote, WritingModelChip } from "@/components/ops-panels";
import { Chip } from "@/components/status-chip";
import { OPS_CARDS, opsCard, type OpsCardDef, type OpsCardKey } from "@/lib/desk/ops-cards";
import {
  dailyScanRows,
  editorsAccessRows,
  healthRows,
  meetingCaptureRows,
  namedOutletsRows,
  paperSetupRows,
  recentlyDeletedRows,
  routineNoticeRows,
  sectionsRows,
  timeBudgetRows,
  writingModelLines,
  youtubeRows,
  type OpsModelLine,
  type OpsRow,
} from "@/lib/desk/ops-rows";
import { editorNamedOutlets } from "@/lib/news/named-outlets";
import { editorSections } from "@/lib/news/sections";
import { getDailyScanPolicy } from "@/lib/news/daily-scan";
import { getMeetingSettingsFn } from "@/lib/news/meeting-settings";
import type { PaperConfig } from "@/lib/news/paper-settings";
import type { SectionConfig } from "@/lib/news/section-types";
import { firstRunSetupState, getPaperConfigForEditor } from "@/lib/news/paper-settings";
import { getRoutineNoticeAutomation } from "@/lib/news/routine-notice-automation";
import { getRoutineNoticePolicy } from "@/lib/news/routine-notice-policy";
import { getYouTubeKeyStateFn } from "@/lib/news/youtube-data-settings";
import { getOpsHealth } from "@/lib/ops/dashboard";
import { getProviderTimeSettings } from "@/lib/news/provider-settings";
import { getProviderStatuses } from "@/lib/news/provider-login";
import { localModelCatalog } from "@/lib/news/provider-availability";
import { listTrash } from "@/lib/news/trash";
import { deskAccess, myDesk } from "@/lib/news/claim";
import { listDarkRuns, type DarkRunRow } from "@/lib/news/dark";

export const Route = createFileRoute("/desk/ops")({
  head: () => ({ meta: [{ title: "Server — TownReporter" }] }),
  /*
    `?signin=claude` is how the Sign in button on a failed draft hands over.
    The control it used to scroll to now lives on `/desk/ops/writing-models`,
    and that is where the button sends people; an old link or bookmark that
    still says `?signin=` lands here, so the page still answers it -- by
    scrolling to the card that owns the door. Anything else in that slot is
    dropped rather than trusted: it decides what this page scrolls to, and it
    arrives from the address bar.
  */
  validateSearch: (search: Record<string, unknown>): { signin?: "claude" | "codex" } => ({
    signin: search.signin === "claude" || search.signin === "codex" ? search.signin : undefined,
  }),
  component: OpsPage,
});

/**
 * The card an old `#hash` lands on.
 *
 * Unit CX removed the jump strip these anchors fed. The ids stay, on the card
 * that carries them and on the card's own screen, because
 * `scripts/named-outlets-e2e.mjs` and `scripts/sections-source-add-e2e.mjs`
 * still visit `/desk/ops#outlets` and `/desk/ops#sections`, and a hash that
 * scrolls nowhere is a broken bookmark.
 *
 * `#custom-ai-connections` used to land on a panel of its own here. Unit CX
 * moved that panel to the Models screen's second tab -- the drawn Writing
 * models card links to it as "All connections" -- so the old bookmark now
 * lands on the card that carries the link. A hash that scrolls nowhere is a
 * broken bookmark; one that scrolls to the door is a slightly stale bookmark,
 * which is what it is.
 */
const HASH_CARDS: readonly { hash: string; card: OpsCardKey }[] = [
  { hash: "custom-ai-connections", card: "writing-models" },
  /* Checked before the substring tests below, so a link to the key box cannot
     be swallowed by a wider match. */
  { hash: "youtube-key", card: "youtube" },
  /* "#named-outlets" opens the outlet list; a link that wants Sections still
     says "section", which the outlets hash does not contain. */
  { hash: "outlet", card: "named-outlets" },
  { hash: "section", card: "sections" },
];

function cardForHash(hash: string): OpsCardKey | null {
  const exact = HASH_CARDS.find((entry) => entry.hash === hash);
  if (exact) return exact.card;
  const partial = HASH_CARDS.find(
    (entry) => entry.hash !== "youtube-key" && hash.includes(entry.hash),
  );
  return partial?.card ?? null;
}

/* --------------------------------------------------------------------------
   What each card reads
   --------------------------------------------------------------------------
   One hook, twelve reads, in the open. Every one is the read the editor behind
   the card's door already used, under the SAME query key, so the summary and
   the screen behind it share one cache entry: a number read here is the number
   the editor opens with, and a save on either screen moves both.

   `enabled: isOwner` on the owner-only reads, because the server refuses them
   anyway (getOpsHealth, getPaperConfigForEditor, getDailyScanPolicy,
   getRoutineNoticePolicy, getRoutineNoticeAutomation, editorNamedOutlets,
   deskAccess, getProviderTimeSettings all call assertOwner, throw
   ForbiddenError or return `{ok:false}`), and an
   editor's page should not fire seven refusals behind a sentence that already
   says whose they are. */

/** The rows a card shows, or why it cannot show them yet. */
type CardBody =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "rows"; rows: OpsRow[] }
  | { state: "ladder"; lines: OpsModelLine[] };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The rows one read answers with.
 *
 * `undefined` data is "not answered yet", which is true of a query that is
 * still in flight AND of one that is switched off for this reader -- but a
 * switched-off read only belongs to a card whose reader is not the owner, and
 * that card draws its note instead of calling this at all.
 */
function bodyOf<T>(q: UseQueryResult<T>, build: (data: T) => OpsRow[]): CardBody {
  if (q.isError) return { state: "error", message: messageOf(q.error) };
  if (q.data === undefined) return { state: "loading" };
  return { state: "rows", rows: build(q.data) };
}

/** The two reads that answer a row set. */
function pairBody<A, B>(
  first: UseQueryResult<A>,
  second: UseQueryResult<B>,
  build: (a: A, b: B) => OpsRow[],
): CardBody {
  if (first.isError) return { state: "error", message: messageOf(first.error) };
  if (second.isError) return { state: "error", message: messageOf(second.error) };
  if (first.data === undefined || second.data === undefined) return { state: "loading" };
  return { state: "rows", rows: build(first.data, second.data) };
}

/**
 * The Paper setup card. FAILS CLOSED: a missing or failed answer to "has this
 * paper been set up" is not "it has been set up", because the config the card
 * reads falls back to the shipped Longmont identity until setup is done. So the
 * card waits for the answer (or says it could not check) instead of printing it.
 */
function paperSetupBody(
  paper: UseQueryResult<PaperConfig>,
  sections: UseQueryResult<SectionConfig>,
  setupState: UseQueryResult<{ needsSetup: boolean }>,
): CardBody {
  if (setupState.isError) return { state: "error", message: messageOf(setupState.error) };
  if (setupState.data === undefined && !paper.isError && !sections.isError) return { state: "loading" };
  if (setupState.data === undefined) return pairBody(paper, sections, paperSetupRows);
  const needsSetup = setupState.data.needsSetup === true;
  return pairBody(paper, sections, (config, sectionConfig) =>
    paperSetupRows(config, sectionConfig, needsSetup),
  );
}

/** One read that answers `{ok:true, policy}` or `{ok:false, error}`. */
function policyBody<T>(
  q: UseQueryResult<{ ok: true; policy: T } | { ok: false; code: string; error: string }>,
  build: (policy: T) => OpsRow[],
): CardBody {
  if (q.isError) return { state: "error", message: messageOf(q.error) };
  if (q.data === undefined) return { state: "loading" };
  if (!q.data.ok) return { state: "error", message: q.data.error };
  return { state: "rows", rows: build(q.data.policy) };
}

function useCardBodies(isOwner: boolean): Record<OpsCardKey, CardBody> {
  /*
    Health, and only health, is watched: a check going down is the one thing on
    this page that changes without anyone touching it. The poll is 30s and it is
    the same 30s the card's own screen polls at, so the two agree.
  */
  const health = useQuery({
    queryKey: ["ops-health"],
    queryFn: () => getOpsHealth(),
    enabled: isOwner,
    refetchInterval: isOwner ? 30_000 : false,
  });
  const paper = useQuery({
    queryKey: ["paper-config-for-setup"],
    queryFn: () => getPaperConfigForEditor(),
    enabled: isOwner,
  });
  /*
    F4: has the owner finished first-run setup? Same server answer and query key
    as /desk/setup and the Server > Paper setup form, so one poll serves all
    three. It decides whether the "Paper setup" card may print the identity the
    desk would otherwise fall back to (Longmont, Colorado and the build-time
    editor address) -- see `paperSetupRows`.
  */
  const setupState = useQuery({
    queryKey: ["first-run-setup"],
    queryFn: () => firstRunSetupState(),
    enabled: isOwner,
  });
  const sections = useQuery({ queryKey: ["editor-sections"], queryFn: () => editorSections() });
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => listTrash() });
  const scan = useQuery({
    queryKey: ["daily-scan-policy"],
    queryFn: () => getDailyScanPolicy(),
    enabled: isOwner,
  });
  const meeting = useQuery({
    queryKey: ["meeting-settings"],
    queryFn: () => getMeetingSettingsFn(),
    enabled: isOwner,
  });
  const youtube = useQuery({ queryKey: ["youtube-api-key"], queryFn: () => getYouTubeKeyStateFn() });
  const notices = useQuery({
    queryKey: ["routine-notice-policy"],
    queryFn: () => getRoutineNoticePolicy(),
    enabled: isOwner,
  });
  const automation = useQuery({
    queryKey: ["routine-notice-automation"],
    queryFn: () => getRoutineNoticeAutomation(),
    enabled: isOwner,
  });
  const outlets = useQuery({
    queryKey: ["editor-named-outlets"],
    queryFn: () => editorNamedOutlets(),
    enabled: isOwner,
  });
  /*
    Editors & access reads the owner ACCOUNT (`deskAccess`), not the paper's
    Contact address. Paper setup's own "Editor email" row is where that address
    belongs, and it still reads it from `paper`.
  */
  const access = useQuery({
    queryKey: ["desk-access"],
    queryFn: () => deskAccess(),
    enabled: isOwner,
  });
  const times = useQuery({
    queryKey: ["provider-times"],
    queryFn: () => getProviderTimeSettings(),
    enabled: isOwner,
  });
  /*
    The two reads behind the ladder's readiness chips. Both are the reads the
    Models screen already makes under these same keys, so the chip on a rung
    here and the card on that screen are one answer: `getProviderStatuses` for
    the two command-line logins (owner-only) and `localModelCatalog` for what
    is answering on this machine (any editor may read it; only the owner's
    ladder uses it). Polled at the Models screen's own 60s, because a sign-in
    that lapses or a server that stops answering is exactly what this column is
    for.
  */
  const statuses = useQuery({
    queryKey: ["provider-statuses"],
    queryFn: () => getProviderStatuses(),
    enabled: isOwner,
    refetchInterval: isOwner ? 60_000 : false,
  });
  const catalog = useQuery({
    queryKey: ["local-model-catalog"],
    queryFn: () => localModelCatalog(),
    enabled: isOwner,
  });

  /*
    Routine notices is the one card whose rows need two reads, and both of them
    can refuse. Written out rather than folded into an abstract "combine three
    results" helper, because the order of the refusals is what a reader sees.
  */
  const routine = ((): CardBody => {
    if (notices.isError) return { state: "error", message: messageOf(notices.error) };
    if (automation.isError) return { state: "error", message: messageOf(automation.error) };
    if (notices.data === undefined) return { state: "loading" };
    if (!notices.data.ok) return { state: "error", message: notices.data.error };
    if (automation.data === undefined) return { state: "loading" };
    if (!automation.data.ok) return { state: "error", message: automation.data.error };
    return {
      state: "rows",
      rows: routineNoticeRows(notices.data.policy, automation.data.automation),
    };
  })();

  /*
    Writing models is still drawn without label/value rows -- the drawing prints
    the ladder as numbered rungs -- but a rung now carries the readiness chip
    the Models screen shows for the same provider, so the card needs the same
    three reads that screen makes. An editor gets the ladder without a column,
    because the reads behind it are the owner's; that is the ladder this card
    has always drawn for them.
  */
  const ladder = ((): CardBody => {
    if (!isOwner) return { state: "ladder", lines: writingModelLines() };
    if (times.isError) return { state: "error", message: messageOf(times.error) };
    if (statuses.isError) return { state: "error", message: messageOf(statuses.error) };
    if (catalog.isError) return { state: "error", message: messageOf(catalog.error) };
    if (times.data === undefined || statuses.data === undefined || catalog.data === undefined) {
      return { state: "loading" };
    }
    return {
      state: "ladder",
      lines: writingModelLines({
        times: times.data,
        statuses: statuses.data,
        catalog: catalog.data,
      }),
    };
  })();

  return {
    "writing-models": ladder,
    health: bodyOf(health, healthRows),
    "paper-setup": paperSetupBody(paper, sections, setupState),
    "recently-deleted": bodyOf(trash, recentlyDeletedRows),
    sections: bodyOf(sections, sectionsRows),
    "daily-scan": policyBody(scan, dailyScanRows),
    "meeting-capture": bodyOf(meeting, meetingCaptureRows),
    youtube: bodyOf(youtube, youtubeRows),
    "routine-notices": routine,
    "named-outlets": bodyOf(outlets, namedOutletsRows),
    "editors-access": bodyOf(access, editorsAccessRows),
    "time-budgets": bodyOf(times, timeBudgetRows),
  };
}

/* --------------------------------------------------------------------------
   One card
   -------------------------------------------------------------------------- */

/** The tones a row can carry, in the shipped chip vocabulary (`.chip.d-*`). */
const ROW_CHIP = { ok: "d-ok", warn: "d-warn", fail: "d-danger" } as const;

/**
 * The drawn rows: label on the left, value on the right, a rule between.
 *
 * A row with a tone is a state rather than a fact -- the database is Down, the
 * disk is nearly full -- and it says so in a chip as well as in words, because
 * color on its own tells a color-blind reader nothing. A plain row is bold
 * text: the drawing bolds every value, and a row that shouted would make the
 * three next to it unreadable. `title` carries `help`, the longer reading the
 * builder put behind the same value.
 */
function OpsRows({ rows }: { rows: OpsRow[] }) {
  return (
    <dl className="astra-ops-rows mt-3">
      {rows.map((row) => (
        <div
          key={row.label}
          className="astra-ops-row flex items-baseline justify-between gap-3 border-t border-rule py-2 text-base"
          title={row.help}
        >
          <dt className="text-muted">{row.label}</dt>
          <dd className="text-right">
            {row.tone === "plain" ? (
              <span className="font-extrabold">{row.value}</span>
            ) : (
              <span className={`chip ${ROW_CHIP[row.tone]}`}>{row.value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Writing models' drawn body: the ladder, rung by rung.
 *
 * Number, name, and the half-line under it -- the three columns the drawing
 * gives every other card's rows, with the ladder's rank in the number slot.
 *
 * The fourth column is the readiness chip, and it IS drawn (unit CX3, 0.6.81
 * fixed this: the card used to leave it out and say so in the report). Two
 * readers put it together, and `writingModelLines` decides which a rung gets:
 * the two command-line rungs carry the `ProviderStatus` from the SAME
 * `getProviderStatuses` read the Models screen uses, so they are handed
 * straight to `WritingModelChip` and the two screens cannot disagree; a local
 * rung carries words `rungWords` derived from that rung's own settings and the
 * local catalog, and they are printed as a `Chip` in the same vocabulary.
 *
 * A rung with no chip is a rung with no chip: an editor's ladder has no column
 * at all (the reads behind it are the owner's), and a provider the registry
 * cannot line up with a status or a setting draws its name and note alone
 * rather than a guess.
 */
function OpsLadder({ lines }: { lines: OpsModelLine[] }) {
  const anyChip = lines.some((line) => line.chip !== undefined);
  const columns = anyChip ? "grid-cols-[28px_minmax(0,1fr)_auto]" : "grid-cols-[28px_minmax(0,1fr)]";
  return (
    <ul className="astra-ops-ladder mt-3">
      {lines.map((line) => (
        <li
          key={line.name}
          className={`astra-ops-rung grid ${columns} items-center gap-x-3 border-t border-rule py-3`}
        >
          <span className="text-base font-extrabold text-muted">{line.n}</span>
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-extrabold">{line.name}</span>
            <span className="text-sm text-muted">{line.note}</span>
          </span>
          {line.chip ? (
            <span data-testid={`ops-rung-chip-${line.name}`}>
              {line.chip.source === "status" ? (
                <WritingModelChip status={line.chip.status} />
              ) : (
                <Chip tone={line.chip.tone} label={line.chip.label} help={line.chip.help} />
              )}
            </span>
          ) : anyChip ? (
            <span />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * One card of the twelve, as the drawing draws it.
 *
 * The title and its half-line, then the rows -- or, for a reader who may not
 * have them, the card's own sentence saying whose they are. The buttons are
 * drawn either way: an editor cannot read the health checks, but the door to
 * the screen where their own way out lives must not close on them, which is
 * exactly what `editors-access` promises in its note.
 */
function SummaryCard({
  card,
  body,
  known,
  isOwner,
}: {
  card: OpsCardDef;
  body: CardBody;
  known: boolean;
  isOwner: boolean;
}) {
  /* Nobody yet knows who is reading: a skeleton, not a sentence about
     permissions shown to the owner for a tenth of a second. */
  const nonOwner = known && !isOwner;
  const refused = nonOwner && card.ownerOnly;
  return (
    <OpsCard id={card.anchor} tall={card.tall}>
      <h2 className="astra-ops-card-title">{card.title}</h2>
      <p className="astra-ops-card-sub">{card.sub}</p>
      {!known ? (
        <ListSkeleton rows={2} />
      ) : refused ? (
        <ReadOnlyNote>{card.editorNote}</ReadOnlyNote>
      ) : body.state === "error" ? (
        <p className="mt-3 max-w-2xl text-base text-rust" data-testid="ops-card-unread">
          {card.title} could not be read: {body.message}
        </p>
      ) : body.state === "loading" ? (
        <ListSkeleton rows={card.rows.length || 2} />
      ) : body.state === "ladder" ? (
        <OpsLadder lines={body.lines} />
      ) : (
        <OpsRows rows={body.rows} />
      )}
      {/* An editor gets the note on the cards whose rows are not theirs; on a
          card they CAN read, the note explains what is not, and only where the
          card carries one. */}
      {nonOwner && !card.ownerOnly && card.editorNote ? (
        <ReadOnlyNote>{card.editorNote}</ReadOnlyNote>
      ) : null}
      <div className="astra-ops-card-doors mt-4 flex flex-wrap gap-2">
        {card.doors.map((door) => (
          <CardDoor key={door.label} door={door} />
        ))}
      </div>
    </OpsCard>
  );
}

/* --------------------------------------------------------------------------
   The screen
   -------------------------------------------------------------------------- */

function OpsPage() {
  const { signin } = Route.useSearch();
  const hash = useRouterState({ select: (s) => s.location.hash });

  /*
    Who is reading the page.

    Unit CX: the drawing gives every card a read-only face for editors who are
    not the owner, and seven of these cards read something the server refuses to
    anyone else. Asking once here and passing the answer down is what lets a
    card say "only the owner can read this" in words instead of rendering a
    skeleton that never resolves.
  */
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const known = me.isSuccess;
  const isOwner = me.data?.role === "owner";
  const bodies = useCardBodies(isOwner);
  const darkRuns = useQuery({ queryKey: ["dark-runs"], queryFn: () => listDarkRuns() });

  useEffect(() => {
    const key = signin ? "writing-models" : cardForHash(hash);
    if (!key) return;
    const anchor = opsCard(key).anchor;
    /* After paint, so the card is laid out before we scroll to it. */
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    });
  }, [signin, hash]);

  return (
    <DeskShell title="Server" kicker="Models, health and setup" hideTitle>
      {/*
        The drawn header: kicker, title, the page's own action, rule. The
        drawing puts "Give up the desk" on the title line, as the one thing on
        this screen that leaves the page, and draws it in its outline style
        (`btns.server` in Desk Screens.dc.html -- the same two-pixel border
        every card button has, one size down).

        It is a door like the rest: it opens the Editors & access screen, which
        is where the button that actually hands the newsroom over has always
        been, and which is the one screen an editor who is not the owner still
        needs. Before unit CX2 it scrolled to a panel on this page; there is no
        panel on this page any more.

        The title is the drawing's "Server". The rail says "Server" too
        (desk-chrome.tsx, DESK_NAV), so the two agree. `hideTitle` is what buys
        the action slot, and it drops the shell's sentence with the title, so
        the same prose is rendered here instead of being lost.
      */}
      <div className="astra-head">
        <div>
          <p className="kick">Models, health and setup</p>
          <h1 className="h1">Server</h1>
        </div>
        <div className="astra-head-acts">
          <Link className="btn" to="/desk/ops/$card" params={{ card: "editors-access" }}>
            Give up the desk
          </Link>
        </div>
      </div>
      <p className="lede">
        Check this machine's models, health and setup.
      </p>
      {/*
        Cards flow left to right in the drawn order, with each row top-aligned.
      */}
      <div className="astra-settings">
        <div className="astra-settings-body">
          {OPS_CARDS.map((card) => (
            <SummaryCard
              key={card.key}
              card={card}
              body={bodies[card.key]}
              known={known}
              isOwner={isOwner}
            />
          ))}
        </div>
      </div>
      <DarkRunHistory runs={darkRuns.data ?? []} loading={darkRuns.isPending} error={darkRuns.error} />
    </DeskShell>
  );
}

function DarkRunHistory({ runs, loading, error }: { runs: readonly DarkRunRow[]; loading: boolean; error: unknown }) {
  return (
    <section className="mt-8" aria-label="Dark Desk run history">
      <details className="astra-panel">
        <summary className="astra-panel-h">Dark Desk run history · {runs.length} recent runs</summary>
        {loading ? <p className="meta">Loading run history…</p> : null}
        {error ? <p className="note err" role="alert">Could not load Dark Desk run history.</p> : null}
        {!loading && !error && !runs.length ? <p className="meta">No Dark Desk runs yet.</p> : null}
        {runs.map((run) => {
          const totals = run.usage.totals;
          const started = new Date(run.started_at);
          return (
            <article key={run.id} className="side-item">
              <p><b>{Number.isFinite(started.getTime()) ? started.toLocaleString() : run.started_at}</b>{run.investigation_id == null ? "" : ` · File ${run.investigation_id}`}{run.model_choice ? ` · ${run.model_choice}` : ""}</p>
              {run.summary ? <p>{run.summary}</p> : null}
              {run.error ? <p className="note err">Stopped: {run.error}</p> : null}
              {run.stopReason ? <p className="meta">Stop reason: {run.stopReason}</p> : null}
              {run.usageRecorded === false ? <p className="meta">Usage not recorded for this older run.</p> : (
                <details>
                  <summary>Run usage · {totals.modelCalls} model calls · {totals.searches} searches · {totals.documentReads} records · {Math.ceil(totals.elapsedMs / 1000)} seconds · {totals.totalTokens ?? "tokens not reported"} tokens</summary>
                  {run.usage.calls.map((call, index) => (
                    <p key={`${call.stage}-${index}`} className="meta">{call.stage} · {call.provider} · {call.model} · {Math.ceil(call.durationMs / 1000)} seconds · {call.result}{call.totalTokens == null ? "" : ` · ${call.totalTokens} tokens`}</p>
                  ))}
                </details>
              )}
            </article>
          );
        })}
      </details>
    </section>
  );
}
