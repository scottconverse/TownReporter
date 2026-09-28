/*
  The editors behind the Server screen's cards (unit CX2).

  `/desk/ops` used to draw every one of these panels open inside its card --
  eighteen thousand pixels of page at 1440 wide, against a drawing that fits in
  a screen and a half. The drawing draws each card as a SUMMARY: two to five
  label/value rows and one or two buttons. So the panels moved here, unchanged,
  and `src/routes/desk.ops_.$card.tsx` renders one of them on its own screen,
  behind the button that names it. Nothing was deleted and nothing was
  rewritten: every control that worked on the old page works on the screen its
  card's button opens, because the control IS this same component.

  Two edits were needed to move them, and only two:

    - `WritingModels` took its `?signin=` search param off `Route.useSearch()`,
      which only the page it lived on could answer. It takes it as a prop now,
      and the route that renders it passes its own.
    - `Health` had no component. Its body was written inline in the page's JSX,
      which is fine for a panel you can see and not for one you cannot, so it is
      `HealthPanel` below, lifted verbatim -- the six actions, the two
      disclosures, the logs, the closing sentence about the watchdog.

  `OpsCard` is here too, because both halves of the pattern draw a card: the
  summary draws twelve of them and each card's own screen draws one.
*/

import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Field, InkButton, LeaveEditorControl, SecHead } from "@/components/desk-chrome";
import { announceToDesk, inputClass } from "@/components/desk-chrome-utils";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ListSkeleton } from "@/components/states";
import { getOpsHealth, runOpsAction } from "@/lib/ops/dashboard";
import { OPS_ACTIONS, type OpsActionId } from "@/lib/ops/actions";
import { installAction } from "@/lib/ops/install-display";
import { formatAgo, overallState, type HealthState } from "@/lib/ops/health";
import { TRASH_DAYS, listTrash, purgeTrashItem, restoreTrashItem } from "@/lib/news/trash";
import { inviteEditor, myDesk } from "@/lib/news/claim";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { PaperSetupForm } from "@/components/paper-setup-form";
import { getPaperConfigForEditor } from "@/lib/news/paper-settings";
/*
  The six settings panels the cards own -- SectionsSetup, NamedOutletsSetup,
  DailyScanSettings, MeetingCaptureSettings, RoutineNoticePermissions,
  YoutubeKeySettings -- are rendered by the card's own screen
  (`src/routes/desk.ops_.$card.tsx`), which imports each one once. They are not
  re-wrapped here: a wrapper whose whole body is another component is a second
  name for the same thing, and the screen is the place that decides what a
  card's screen shows.
*/
import { opsCard, type OpsCardDoor } from "@/lib/desk/ops-cards";
import { getDarkCounty, saveDarkCounty } from "@/lib/news/dark";
import { getProviderStatuses, type ProviderStatus } from "@/lib/news/provider-login";
import { getProviderTimeSettings } from "@/lib/news/provider-settings";
import { ProviderTimeField } from "@/components/provider-time-field";
import { editorActionError, inviteMessage } from "@/lib/news/desk-copy";
import { automaticOrderSentence } from "@/lib/news/model-choice";
import { localModelCatalog, refreshLocalModelCatalog } from "@/lib/news/provider-availability";
import { XaiOauthConnection } from "@/components/xai-oauth-connection";
import { ProviderStatusCard } from "@/components/provider-status-card";
import { Chip } from "@/components/status-chip";

/**
 * Color carries no information on its own here.
 *
 * Every row states its condition in words as well, because "is that dot amber
 * or red" is not a thing to be squinting at when the paper is down, and a
 * color-blind operator gets nothing from the dot at all.
 */
const DOT: Record<HealthState, string> = {
  ok: "bg-emerald-600",
  warn: "bg-amber-500",
  down: "bg-rust",
  unknown: "bg-muted",
};

const WORD: Record<HealthState, string> = {
  ok: "OK",
  warn: "Check",
  down: "Down",
  unknown: "Unknown",
};

export function StateDot({ state }: { state: HealthState }) {
  return (
    <span className="chip">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[state]}`} aria-hidden />{" "}
      {WORD[state]}
    </span>
  );
}

/**
 * One card of the Server grid.
 *
 * `.astra-panel` is the shipped card (surface, 1px rule, 18/20 padding), so a
 * card here is the same box every other panel on the desk is. The id is what
 * the old anchors and the walks scroll to, and it is carried by the card on the
 * summary page AND by the card's own screen, so `#ops-panel-<x>` keeps landing
 * on the same card now that the card has two homes.
 *
 * `tall` is the drawing's `grid-row:span 2` on Writing models -- the one card
 * that is twice as long as its neighbours. It is reset to `auto` in the
 * one-column media query, where spanning two rows would leave a hole.
 */
export function OpsCard({
  id,
  tall,
  children,
}: {
  id: string;
  tall?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className={`astra-ops-card astra-panel astra-jump${tall ? " astra-ops-card-tall" : ""}`}
    >
      {children}
    </div>
  );
}

/**
 * The drawn button at the foot of a card.
 *
 * Two things it can be, and both are links, because both leave the screen the
 * button is on. A door onto the Server page's one pattern goes to
 * `/desk/ops/<card>`; the drawing's own two Writing-models buttons go to the
 * Models screen, where those two lists already are. `solid` is the drawn yellow
 * and `plain` the drawn outline -- the shipped `.btn` classes, which the design
 * system declares at exactly the drawing's border width and 44px floor.
 *
 * It lives here, beside `OpsCard`, because both halves of the pattern draw one:
 * the summary draws a card's doors under its rows, and a card's own screen
 * draws the doors that lead anywhere but back to itself.
 */
export function CardDoor({ door }: { door: OpsCardDoor }) {
  const className = door.tone === "solid" ? "btn solid" : "btn";
  if (door.card) {
    return (
      <Link className={className} to="/desk/ops/$card" params={{ card: opsCard(door.card).slug }}>
        {door.label}
      </Link>
    );
  }
  if (!door.href) return null;
  return (
    <Link
      className={className}
      to={door.href}
      search={(door.search ?? {}) as { tab?: "assign" | "conn" }}
    >
      {door.label}
    </Link>
  );
}

/**
 * What a card says to an editor who is not the owner.
 *
 * Unit CX item 4. Eight of these cards read something only the owner may read
 * (this machine's health, the writing models' sign-ins, the paper's setup, the
 * sections, the daily scan policy, meeting capture, the named outlets, the time
 * budgets), and the server refuses the read rather than trusting the UI to hide
 * it. Before, the card drew its loading skeleton and stayed there: "◉UNKNOWN"
 * over grey bars, which reads as a broken page rather than a permission. One
 * plain sentence is the honest answer, and it is a sentence an editor can act
 * on -- ask the owner.
 */
export function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 max-w-2xl text-base text-ink-2" data-testid="ops-read-only">
      {children}
    </p>
  );
}

/**
 * A whole card's body, for someone who may not read the card.
 *
 * Unit CX item 4: the card keeps the name the drawing gives it, and its body
 * is one plain sentence. Without the title an editor's Server page is a grid
 * of unlabelled sentences -- you cannot tell "Daily scan" from "Meeting
 * capture" -- and without the sentence it is a skeleton. Both halves matter:
 * the drawing draws a named card with a body.
 */
export function ReadOnlyCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <SecHead title={title} />
      <ReadOnlyNote>{children}</ReadOnlyNote>
    </section>
  );
}

/**
 * Server health: the checks, the logs and the six machine actions.
 *
 * Lifted verbatim out of the old page's JSX (unit CX2). The two buttons the
 * drawing puts at the foot of the Health card -- "View logs" and "Restart
 * workers" -- are disclosures rather than links, because the drawing gives the
 * two panels behind them no other door: they open in place, under the button
 * that asked for them. Recorded in design/SPEC-GAPS-0681.md (CX).
 *
 * `aria-expanded`/`aria-controls` rather than InkButton, which takes no aria
 * props: a disclosure that a screen reader cannot tell is open is a control
 * that lies about its state.
 */
export function HealthPanel() {
  const [showLogs, setShowLogs] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [confirming, setConfirming] = useState<OpsActionId | null>(null);
  const [message, setMessage] = useState<string>("");
  const [running, setRunning] = useState<OpsActionId | null>(null);
  const qc = useQueryClient();

  const health = useQuery({
    queryKey: ["ops-health"],
    queryFn: () => getOpsHealth(),
    // The page is read, not watched. A poll every 30s keeps it honest without
    // running PowerShell probes forever behind a forgotten open tab.
    refetchInterval: 30_000,
  });

  const act = useMutation({
    mutationFn: (id: OpsActionId) => runOpsAction({ data: id }),
    onMutate: (id) => {
      setRunning(id);
      setMessage("");
    },
    onSuccess: (res) => {
      setRunning(null);
      setConfirming(null);
      /*
        A reply can be missing without anything having gone wrong.

        Restarting the tunnel cuts the path this very answer travels on, so the
        call resolves to nothing. Reading `res.output` then threw "Cannot read
        properties of undefined" and the page reported an error for an action
        that had just succeeded.
      */
      if (!res) {
        setMessage(
          "No answer came back. That is expected when the action interrupts the connection it would reply on — check the health rows above in a few seconds.",
        );
      } else {
        setMessage(res.output || (res.ok ? "Done." : "Failed."));
      }
      void qc.invalidateQueries({ queryKey: ["ops-health"] });
    },
    onError: (err) => {
      setRunning(null);
      setConfirming(null);
      setMessage(err instanceof Error ? err.message : "That did not run.");
    },
  });

  const checks = health.data?.checks ?? [];
  const state = checks.length ? overallState(checks) : "unknown";

  return (
    <>
      <section className="mt-12">
        <SecHead
          title="Health"
          aside={
            <span className="flex items-center gap-4">
              <StateDot state={state} />
              <InkButton tone="quiet" onClick={() => void health.refetch()} disabled={health.isFetching}>
                {health.isFetching ? "Checking…" : "Check now"}
              </InkButton>
            </span>
          }
          sub={
            health.data ? `${health.data.host} · read ${formatAgo(health.data.takenAt)}` : undefined
          }
        />

        {health.isPending ? (
          <ListSkeleton />
        ) : health.isError ? (
          <p className="mt-4 text-rust">Could not read the server. {String(health.error)}</p>
        ) : (
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                <span className="w-40 shrink-0 text-sm tracking-[0.14em] text-muted uppercase">
                  {c.label}
                </span>
                <span className="min-w-0 flex-1 break-words">{c.value}</span>
                <StateDot state={c.state} />
                {c.note ? <p className="w-full text-sm text-ink-2">{c.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          className="btn small quiet"
          aria-expanded={showLogs}
          aria-controls="ops-logs-panel"
          onClick={() => setShowLogs((open) => !open)}
        >
          {showLogs ? "Hide logs" : "View logs"}
        </button>
        <button
          type="button"
          className="btn small quiet"
          aria-expanded={showActions}
          aria-controls="ops-actions-panel"
          onClick={() => setShowActions((open) => !open)}
        >
          {showActions ? "Hide actions" : "Restart workers"}
        </button>
      </div>

      <section className="mt-12" id="ops-actions-panel" hidden={!showActions}>
        <SecHead
          title="Actions"
          sub="Each one says what it does before it does it. The two that interrupt the paper ask twice."
        />
        <ul className="mt-4 space-y-3">
          {OPS_ACTIONS.map((rawAction) => {
            const a = installAction(rawAction, Boolean(health.data?.managedInstall));
            const unavailable = health.data?.unavailableActions?.[a.id];
            const isConfirming = confirming === a.id;
            const isRunning = running === a.id;
            return (
              <li key={a.id} className="astra-panel">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-display text-lg font-semibold">
                    {a.label}
                    {a.interrupts ? (
                      <span className="ml-2 text-sm tracking-[0.14em] text-rust uppercase">
                        interrupts
                      </span>
                    ) : null}
                  </h3>
                  {isConfirming ? (
                    <span className="flex gap-2">
                      <InkButton
                        tone="danger"
                        disabled={isRunning || Boolean(unavailable) || !health.data}
                        onClick={() => act.mutate(a.id)}
                      >
                        {isRunning ? "Running…" : "Yes, do it"}
                      </InkButton>
                      <InkButton tone="quiet" onClick={() => setConfirming(null)}>
                        Cancel
                      </InkButton>
                    </span>
                  ) : (
                    <InkButton
                      tone={a.interrupts ? "ghost" : "solid"}
                      disabled={Boolean(running) || Boolean(unavailable) || !health.data}
                      onClick={() => (a.interrupts ? setConfirming(a.id) : act.mutate(a.id))}
                    >
                      {isRunning ? "Running…" : "Run"}
                    </InkButton>
                  )}
                </div>
                <p className="mt-2 max-w-2xl text-ink-2">
                  {health.data ? a.detail : "Checking installation ownership…"}
                </p>
                {unavailable ? <p className="mt-2 text-sm">Unavailable: {unavailable}</p> : null}
                <p className="mt-1 text-sm text-muted">Takes about {a.expectSeconds} seconds.</p>
              </li>
            );
          })}
        </ul>
        {message ? (
          <pre className="mt-4 max-h-72 overflow-auto border border-rule bg-paper-2 p-3 text-sm whitespace-pre-wrap">
            {message}
          </pre>
        ) : null}
      </section>

      <section className="mt-12" id="ops-logs-panel" hidden={!showLogs}>
        <SecHead title="Logs" sub="The last few lines of each. Newest at the bottom." />
        <div className="mt-4 space-y-6">
          {(health.data?.logs ?? []).map((l) => (
            <div key={l.path}>
              <h3 className="astra-label">{l.name}</h3>
              {l.error ? (
                <p className="mt-1 text-sm text-muted">{l.error}</p>
              ) : l.lines.length === 0 ? (
                <p className="mt-1 text-sm text-muted">Nothing logged.</p>
              ) : (
                <pre className="mt-1 max-h-56 overflow-auto border border-[var(--line)] bg-[var(--bg2)] p-3 text-sm whitespace-pre-wrap text-[var(--fg)]">
                  {l.lines.join("\n")}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>

      <p className="mt-12 max-w-2xl text-sm text-muted">
        {health.data?.managedInstall
          ? "This page runs inside the paper. If the server is down, use Start TownReporter.cmd and the logs in your private data folder. This local installation has no automatic Windows watchdog or startup task."
          : "This page runs inside the paper, so it cannot report when the server is down. Use your installation's external controls. Automatic recovery is available only when its operator has separately configured and verified it."}
      </p>
    </>
  );
}

/**
 * How long the desk waits for one answer from each writing model.
 *
 * Unit CX moved these fields here, out of each sign-in card, because the
 * drawing gives them a card of their own ("Time budgets", Desk Screens.dc.html
 * `panels`: "Local models — 10 min per call", "Subscription CLIs — 150 s per
 * call"). They are the SAME fields, one per provider, saving through the same
 * `ProviderTimeField` -- moved, not copied, so there is still exactly one
 * place on the desk where a timeout can be changed.
 *
 * Owner-only on the server (src/lib/news/provider-settings.ts refuses a plain
 * editor), which is why the card has a read-only face.
 */
export function TimeBudgets() {
  const [note, setNote] = useState("");
  const times = useQuery({
    queryKey: ["provider-times"],
    queryFn: () => getProviderTimeSettings(),
  });
  const rows = times.data ?? [];
  return (
    <section className="mt-16 border-t border-rule pt-8">
      <SecHead
        title="Time budgets"
        sub="How long one answer from each model may take before the desk gives up on it."
      />
      <p aria-live="polite" role="status" className="sr-only">
        {note}
      </p>
      {times.isPending ? (
        <ListSkeleton rows={2} />
      ) : times.isError ? (
        <p className="mt-4 text-rust">Could not read the time limits. {String(times.error)}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 max-w-2xl text-sm text-muted">
          No model on this machine takes a time limit yet. One appears here as soon as a model is
          signed in or pointed at.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <div key={row.providerId} className="astra-panel">
              <h3 className="font-display text-lg font-semibold">{row.label}</h3>
              <p className="mt-1 text-sm text-ink-2">{row.detail}</p>
              <ProviderTimeField row={row} onNote={setNote} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Writing models: is the paper able to write, and can the operator fix it here.
 *
 * The desk drafts through two locally installed CLIs on the operator's own
 * subscriptions. When one of those logins lapses every draft fails, and until
 * 0.6.0 the desk could only say "sign in again" — which meant a terminal, and
 * this operator is point-and-click. The Sign in button spawns the CLI's own
 * headless login and shows what it prints: a link for Claude Code, a link and a
 * one-time code for Codex.
 *
 * There is deliberately NO sign-out button. Signing out is one mis-click that
 * stops the live paper, and nothing on this page needs it — a stale login is
 * fixed by signing in again, not by signing out first.
 *
 * Owner-only, and enforced on the server (see src/lib/news/provider-login.ts),
 * not merely hidden here. Unit CX added `known`: while nobody yet knows who is
 * reading, the card shows a skeleton rather than the sentence for an editor,
 * because "only the owner can see this" shown to the owner for a tenth of a
 * second is a lie the page tells about itself.
 *
 * Unit CX2 made `signin` a prop. It used to come off `Route.useSearch()` on the
 * page this panel lived on; the panel has a screen of its own now, and the
 * route that renders it is the one that can read the address bar.
 */
export function WritingModelsPanel({
  isOwner,
  known,
  signin,
}: {
  isOwner: boolean;
  known: boolean;
  signin?: "claude" | "codex";
}) {
  const [note, setNote] = useState("");

  const statuses = useQuery({
    queryKey: ["provider-statuses"],
    queryFn: () => getProviderStatuses(),
    enabled: isOwner,
    refetchInterval: 60_000,
  });

  /*
    How long this paper lets each writing model take (0.6.2).

    A separate query from the sign-in statuses on purpose: the statuses poll
    every minute because a login can lapse at any moment, and re-reading a
    stored number that only changes when someone types in this panel on the
    same schedule would be noise. Owner-only on the server as well as here.
  */
  const times = useQuery({
    queryKey: ["provider-times"],
    queryFn: () => getProviderTimeSettings(),
    enabled: isOwner,
  });

  /**
   * Which providers this machine has that draw no sign-in row of their own.
   *
   * This is the list the block at the foot of the card explains. It is NOT a
   * list of time fields any more: since unit CX the timeouts have their own
   * card ("Time budgets"), and a card that says where to change a number is
   * not allowed to also offer a second box that changes it.
   */
  const gatewayRows = (times.data ?? []).filter(
    (row) =>
      !["claude-code", "anthropic", "codex", "xai-oauth"].includes(row.kind) &&
      row.availableOnThisMachine,
  );

  /*
    Arriving from a failed draft, the panel is the whole reason for the trip —
    and on a long Server page it is easy to land above it and not know. Scroll
    to it once, and say so in the live region for anyone not looking.
  */
  const scrollHere = useCallback(
    (node: HTMLElement | null) => {
      if (node && signin) {
        node.scrollIntoView({ block: "start" });
        setNote("Writing models: the sign-in you started is below.");
      }
    },
    [signin],
  );

  return (
    <section className="mt-8" id="writing-models" ref={scrollHere}>
      <SecHead
        title="Writing models"
        aside={
          isOwner ? (
            <InkButton tone="quiet" onClick={() => void statuses.refetch()} disabled={statuses.isFetching}>
              {statuses.isFetching ? "Checking…" : "Check now"}
            </InkButton>
          ) : undefined
        }
        sub="Whether this machine can write at all, and the button that fixes it when it cannot."
      />
      <p aria-live="polite" role="status" className="sr-only">
        {note}
      </p>
      {/*
        0.6.63 (Unit Y item 5): the order Automatic tries, in plain words. The
        sentence comes from model-choice.ts's `automaticOrderSentence`, which
        reads `automaticLadder` -- the same list the runs walk -- so this panel
        cannot advertise an order the desk no longer has. Shown to everyone:
        it is a fact about the desk, not about this machine's logins.
      */}
      <p className="mt-4 max-w-2xl text-sm text-ink-2">{automaticOrderSentence()}</p>
      {/*
        Unit CX item 4: what an editor who is not the owner sees.

        The sign-in list is owner-only on the server, so for anyone else the
        query never runs and the card used to draw a skeleton that could not
        resolve -- a loading state for a read that was never going to happen.
        One plain sentence says the same thing and stays true.
      */}
      {!known ? (
        <ListSkeleton rows={2} />
      ) : !isOwner ? (
        <ReadOnlyNote>
          Only the owner can see which writing models this machine is signed in to, and can sign
          one back in. Both buttons below open the same lists; they will say what is yours to
          change and what is not.
        </ReadOnlyNote>
      ) : statuses.isPending ? (
        <ListSkeleton rows={2} />
      ) : statuses.isError ? (
        <p className="mt-4 text-rust">
          Could not read the writing models. {String(statuses.error)}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {(statuses.data ?? []).map((s) => (
            <ProviderStatusCard
              key={s.provider}
              status={s}
              onNote={setNote}
              /*
                Unit CX: the per-call timeout used to be drawn here, under the
                sign-in row it belongs to, AND in the Time budgets card that the
                drawing gives the numbers their own home. Two boxes, one stored
                number, so an operator could change it in one place and read the
                old value in the other. The Time budgets card owns it now; this
                one lists the models and their sign-ins and nothing else.
              */
              times={[]}
              chip={<WritingModelChip status={s} />}
            />
          ))}
        </ul>
      )}
      {/*
        The two doors the drawing puts at the foot of this card. They are NOT
        repeated on this panel's own screen: a button that opens the screen you
        are standing on is not a door, it is a loop.
      */}
      {isOwner ? (
        <>
          <XaiOauthConnection onNote={setNote} />
          {/*
            Providers with no sign-in row of their own.

            A configured gateway (LLM_BASE_URL) has no login to manage here -- it
            is an endpoint the operator pointed at -- and this block is what says
            so, so a model the desk is drafting through does not look missing
            from the list above.

            It used to carry the provider's per-call timeout as well. Unit CX
            took that out: the Time budgets card draws a field for every provider
            on this machine, including these, so the field here was the second
            box for a number that has one home. Shown only when the machine
            actually has such a provider.
          */}
          {gatewayRows.map((row) => (
            <div key={row.providerId} className="astra-panel">
              <h3 className="font-display text-lg font-semibold">{row.label}</h3>
              <p className="mt-1 text-sm text-ink-2">
                {row.detail}. No sign-in to manage here: this one is configured by the operator.
              </p>
            </div>
          ))}
          <LocalModelCatalogTable onNote={setNote} />
          <p className="mt-4 max-w-2xl text-sm text-muted">
            These are the command-line tools TownReporter drafts with. Being signed in to claude.ai
            in your browser or the Claude desktop app is a separate login and does not count here.
          </p>
        </>
      ) : null}
    </section>
  );
}

/**
 * The readiness chip the drawing draws on each writing model's row, in the
 * card's top-right corner (Desk Screens.dc.html, `models`: `● Ready`,
 * `! Slow`, `Key rejected`).
 *
 * The drawing's three words are a mock of one machine's afternoon. Two of the
 * three facts behind them do not survive contact with the real status read,
 * and saying a word the reader cannot act on would be worse than saying fewer
 * of them, so the TONES are the drawing's and the WORDS are this page's:
 *
 *   - "Key rejected" is drawn for an expired API key. This card's rows are
 *     command-line subscriptions, and what a lapsed subscription reports is
 *     that it is not signed in -- so the chip says "Sign in needed", in the
 *     drawing's dashed danger, and the provider's own words ride in the
 *     tooltip. Recorded in design/SPEC-GAPS-0681.md (CX).
 *   - "Slow" is drawn for a local model at 18 tok/s. Nothing on this read
 *     measures speed, so no chip claims it; the warn tone is used for the one
 *     comparable fact that is measured, a Test that came back failed.
 *
 * The tones and the map from state to tone are the same four the Models screen
 * uses (`Chip` in components/status-chip.tsx), so the two screens cannot drift.
 */
export function WritingModelChip({ status }: { status: ProviderStatus }) {
  if (status.disabledByOperator) {
    return (
      <Chip
        tone="quiet"
        label="Turned off"
        help={`${status.name} is switched off for this installation. A start-up setting turns it back on.`}
      />
    );
  }
  if (!status.installed) {
    return (
      <Chip
        tone="quiet"
        label="Not installed"
        help={`The ${status.name} command was not found on this machine, so the desk cannot use it.`}
      />
    );
  }
  if (!status.signedIn) {
    return (
      <Chip
        tone="signin"
        label="Sign in needed"
        help={status.detail || `${status.name} is installed but not signed in.`}
      />
    );
  }
  if (status.lastTest && !status.lastTest.ok) {
    return (
      <Chip
        tone="slow"
        label="Last test failed"
        help={status.lastTest.detail || `${status.name} is signed in, but its last test failed.`}
      />
    );
  }
  return (
    <Chip
      tone="ready"
      label="Ready"
      help={
        status.account
          ? `${status.name} is signed in as ${status.account}.`
          : `${status.name} is installed and signed in.`
      }
    />
  );
}

/**
 * Every local model this machine can currently see, one row per model,
 * grouped by server -- the full catalog `local-models.ts` discovers,
 * which the pickers only ever show a slice of. "Default" marks the model
 * Automatic-equivalent resolution would pick when no newsroom has chosen one
 * yet (see `pickDefault` in that module).
 */
export function LocalModelCatalogTable({ onNote }: { onNote: (text: string) => void }) {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["local-model-catalog"],
    queryFn: () => localModelCatalog(),
  });
  const refresh = useMutation({
    mutationFn: () => refreshLocalModelCatalog(),
    onSuccess: (data) => {
      qc.setQueryData(["local-model-catalog"], data);
      onNote("Local model list refreshed.");
    },
  });
  if (catalog.isPending) return null;
  const servers = catalog.data?.servers ?? [];
  const def = catalog.data?.defaultModel;
  if (servers.length === 0) return null;
  return (
    <div className="astra-panel">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">Local servers found on this machine</h3>
        <InkButton tone="quiet" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? "Checking…" : "Refresh"}
        </InkButton>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-rule">
              <th className="py-1 pr-3">Server</th>
              <th className="py-1 pr-3">Model</th>
              <th className="py-1 pr-3">Loaded</th>
              <th className="py-1 pr-3">Thinking</th>
              <th className="py-1 pr-3">Vision</th>
              <th className="py-1 pr-3">Default</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) =>
              server.reachable ? (
                server.models.length === 0 ? (
                  <tr key={server.baseUrl} className="border-b border-rule/40">
                    <td className="py-1 pr-3">{server.baseUrl}</td>
                    <td className="py-1 pr-3 text-muted" colSpan={5}>
                      No chat models found.
                    </td>
                  </tr>
                ) : (
                  server.models.map((model) => (
                    <tr key={`${server.baseUrl}-${model.id}`} className="border-b border-rule/40">
                      <td className="py-1 pr-3">{server.baseUrl}</td>
                      <td className="py-1 pr-3">{model.id}</td>
                      <td className="py-1 pr-3">
                        {model.loaded === null ? "unknown" : model.loaded ? "yes" : "no"}
                      </td>
                      <td className="py-1 pr-3">
                        {model.thinking ? "yes (off by default)" : "no"}
                      </td>
                      <td className="py-1 pr-3">{model.vision ? "yes" : "no"}</td>
                      <td className="py-1 pr-3">
                        {def && def.baseUrl === server.baseUrl && def.id === model.id ? "★" : ""}
                      </td>
                    </tr>
                  ))
                )
              ) : (
                <tr key={server.baseUrl} className="border-b border-rule/40">
                  <td className="py-1 pr-3">{server.baseUrl}</td>
                  <td className="py-1 pr-3 text-rust" colSpan={5}>
                    Configured but unreachable.
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Recently deleted.
 *
 * Delete is one click away from the whole desk, which is what the operator
 * asked for; this is the floor under it. A lead takes its drafts with it and an
 * editorial draft has no copy anywhere, so before this a mis-click was final.
 *
 * The row says what restoring it would bring back, because "a lead" and "a lead
 * and the two drafts on it" are different things to get back.
 */
export function RecentlyDeletedPanel() {
  const { formatDateTime } = usePaperDateFormatters();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [confirmPurge, setConfirmPurge] = useState<number | null>(null);

  const list = useQuery({ queryKey: ["trash"], queryFn: () => listTrash() });

  const invalidateEverything = () => {
    for (const key of ["trash", "leads", "editorials", "published-desk", "articles"]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const restore = useMutation({
    mutationFn: (id: number) => restoreTrashItem({ data: id }),
    onSuccess: (r) => {
      setNote(r?.ok ? "Back on the desk." : (r?.error ?? "That would not go back."));
      invalidateEverything();
    },
    onError: (e) => setNote(e instanceof Error ? e.message : "That would not go back."),
  });

  const purge = useMutation({
    mutationFn: (id: number) => purgeTrashItem({ data: id }),
    onSuccess: (r) => {
      setConfirmPurge(null);
      setNote(r?.ok ? "Gone for good." : (r?.error ?? "That did not work."));
      void qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (e) => setNote(e instanceof Error ? e.message : "That did not work."),
  });

  const rows = list.data ?? [];

  return (
    <section className="mt-12">
      <SecHead
        title="Recently deleted"
        count={rows.length || null}
        sub={`Anything deleted from the desk waits here for ${TRASH_DAYS} days, then goes for good. Restoring puts it back where it was.`}
      />
      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      {list.isPending ? (
        <ListSkeleton rows={2} />
      ) : rows.length === 0 ? (
        <p className="mt-4 text-ink-2">Nothing deleted.</p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="text-sm tracking-[0.14em] text-rust uppercase">
                    {r.kind === "article"
                      ? "Was on the paper"
                      : r.kind === "lead"
                        ? "Lead"
                        : "Editorial"}
                  </span>{" "}
                  <span className="font-display text-lg">{r.label}</span>
                  {r.extra ? <span className="ml-2 text-sm text-muted">with {r.extra}</span> : null}
                </span>
                <span className="row-acts static">
                  <InkButton
                    tone="quiet"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(r.id)}
                  >
                    Restore
                  </InkButton>
                  {confirmPurge === r.id ? (
                    <>
                      <InkButton
                        tone="ghost"
                        disabled={purge.isPending}
                        onClick={() => purge.mutate(r.id)}
                      >
                        Yes, for good
                      </InkButton>
                      <InkButton tone="quiet" onClick={() => setConfirmPurge(null)}>
                        Keep
                      </InkButton>
                    </>
                  ) : (
                    <InkButton tone="quiet" onClick={() => setConfirmPurge(r.id)}>
                      Delete for good
                    </InkButton>
                  )}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">Deleted {formatDateTime(r.deleted_at)}</p>
              {confirmPurge === r.id ? (
                <p className="mt-1 text-sm text-rust">
                  This is the copy. After this there is nothing to restore.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * CITY-SETUP final slice: the same setup form as the first-run gate
 * (src/routes/desk.setup.tsx), reachable again here so a mistake made
 * during setup -- the wrong timezone, a typo in the city -- is fixable
 * without touching a file. Owner-only, same as Invite an editor.
 */
export function PaperSetupPanel() {
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const current = useQuery({
    queryKey: ["paper-config-for-setup"],
    queryFn: () => getPaperConfigForEditor(),
    enabled: me.data?.role === "owner",
  });
  if (me.data?.role !== "owner") return null;
  return (
    <section className="mt-16 border-t border-rule pt-8">
      <SecHead
        title="Paper setup"
        sub="The paper's name, city, state, timezone, tagline and starting watch list. Saving also rewrites the welcome article on the front page to match."
      />
      <p className="mt-2 max-w-2xl text-sm text-muted">
        What Save does: it writes every field below; rewrites the front-page kicker and deck from
        the paper's name and city; and rewrites the welcome article. Published stories are not
        touched. There is no undo, but you can edit again and save over it. The starting watch list
        is added as real rows on the Sources page, not just stored as a default — each editor gets
        them added once, the first time they visit.
      </p>
      {current.isPending ? null : <PaperSetupForm initial={current.data} submitLabel="Save" />}
      {me.data?.role === "owner" ? <DarkDeskCounty /> : null}
    </section>
  );
}

/**
 * County for the Dark Desk's searches (0.6.22 owner request).
 *
 * A separate small field with its own save, not folded into the big Paper
 * setup form above: it writes `dark_settings.county`, not `paper_settings`
 * -- the same table and the same newsroom-scoped upsert the dig/nerve/scope
 * dials already use (saveDarkDials in src/lib/news/dark.ts), because
 * `readDarkPlace` (the Dark Desk's own location-scoping read) already reads
 * county from there and nothing wrote it. Kept in Paper setup rather than on
 * the Dark Desk page itself because it is paper identity -- where the paper
 * *is* -- not a run dial like dig/nerve/scope.
 */
export function DarkDeskCounty() {
  const county = useQuery({ queryKey: ["dark-county"], queryFn: () => getDarkCounty() });
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!touched && county.data) setValue(county.data.county);
  }, [county.data, touched]);

  const save = useMutation({
    mutationFn: (input: { county: string }) => saveDarkCounty({ data: input }),
    onSuccess: (res) => {
      setErr(null);
      setSavedAt(Date.now());
      setTouched(false);
      announceToDesk(
        res.county ? "County saved." : "County cleared. Dark Desk searches will use the city only.",
      );
    },
    onError: (e) => {
      // The county box has no `maxLength`, and `darkCountyInput.county` is
      // capped at `LIMITS.county` (80), so a longer paste is refused by the
      // client validator and arrives here as an issues array.
      const msg =
        editorActionError(e instanceof Error ? e.message : "", "save the county") ?? "That did not save.";
      setErr(msg);
      announceToDesk("County did not save.");
    },
  });

  return (
    <div className="mt-6 max-w-md">
      <Field
        label="County"
        hint="Used when the Dark Desk searches — it looks for the city and the county. Blank means it searches by city only."
      >
        <input
          className={inputClass + " mt-1 w-full"}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setTouched(true);
            setSavedAt(null);
          }}
          placeholder="Boulder County"
        />
      </Field>
      <div className="mt-2 flex items-center gap-3">
        <InkButton
          tone="quiet"
          disabled={save.isPending || county.isPending}
          onClick={() => save.mutate({ county: value })}
        >
          {save.isPending ? "Saving…" : "Save county"}
        </InkButton>
        {savedAt ? <p className="text-sm text-ink-2">Saved.</p> : null}
        {err ? <p className="text-sm text-rust">{err}</p> : null}
      </div>
    </div>
  );
}

/**
 * Copy `text` to the clipboard. Tries the async Clipboard API first; if it
 * is unavailable (older browser, insecure context) or throws (permission
 * denied), falls back to a hidden, selected textarea and the legacy
 * `execCommand("copy")` so the button still does something instead of
 * silently failing on a click.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the selection-based fallback below
    }
  }
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
  return false;
}

/**
 * Invite a second editor (v0.5.3). Owner-only, enforced server-side; the UI
 * simply does not render the form for an invited editor. The minted link is
 * shown ONCE -- the server stores only a hash -- so the owner copies it here
 * and hands it over however they like. It expires in seven days, works for
 * exactly the named address, and burns on use.
 */
export function InviteAnEditorPanel() {
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const paper = useQuery({
    queryKey: ["paper-config-for-invite"],
    queryFn: () => getPaperConfigForEditor(),
    enabled: me.data?.role === "owner",
  });
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const mint = useMutation({
    mutationFn: () => inviteEditor({ data: email }),
    onSuccess: (r) => {
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setErr(null);
      setCopiedLink(false);
      setCopiedMessage(false);
      setLink(`${window.location.origin}/login?invite=${r.token}`);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "That did not mint."),
  });
  if (me.data?.role !== "owner") return null;
  const message =
    link && paper.data
      ? inviteMessage({
          paperName: paper.data.name,
          email,
          link,
          ownerEmail: paper.data.editorEmail,
        })
      : null;
  return (
    <section className="mt-16 border-t border-rule pt-8">
      <SecHead
        title="Invite an editor"
        sub="A one-time link for one email address. It expires in seven days, and the person sets their own password. Editors can report, draft and publish. Ownership, invitations, legal removals and owner-only server settings stay with the owner."
      />
      <p className="mt-2 max-w-2xl text-sm text-muted">
        You will get a link to send yourself. TownReporter does not send email.
      </p>
      <div className="mt-4 max-w-2xl space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            Their email
            <input
              className="mt-1 min-h-11 border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.org"
            />
          </label>
          <InkButton disabled={mint.isPending || !email.trim()} onClick={() => mint.mutate()}>
            {mint.isPending ? "Minting…" : "Make the invite link"}
          </InkButton>
        </div>
        {err ? <p className="text-sm text-rust">{err}</p> : null}
        {link ? (
          <div className="border border-rule bg-paper-2 p-3">
            <p className="astra-label">Shown once — copy it now</p>
            <p className="mt-1 text-sm break-all">{link}</p>
            <InkButton
              tone="quiet"
              onClick={() => {
                void copyToClipboard(link).then((ok) => ok && setCopiedLink(true));
              }}
            >
              {copiedLink ? "Copied" : "Copy link"}
            </InkButton>
            {message ? (
              <div className="mt-3 border-t border-rule pt-3">
                <p className="astra-label">Ready-to-send message</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{message}</p>
                <InkButton
                  tone="quiet"
                  onClick={() => {
                    void copyToClipboard(message).then((ok) => ok && setCopiedMessage(true));
                  }}
                >
                  {copiedMessage ? "Copied" : "Copy message"}
                </InkButton>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm text-muted">
          What happens next: they click the link, set a password, and appear on this page as an
          editor. They cannot invite others or give up the desk.
        </p>
      </div>
    </section>
  );
}

/**
 * The one irreversible thing on this page, kept furthest from everything else.
 *
 * It used to be a button in the header of every desk page. See
 * LeaveEditorControl in desk-chrome.tsx for what an audit found when it walked
 * that path. It belongs here, at the bottom of the page an operator visits on
 * purpose, and nowhere else.
 *
 * Unit CX2: it is NOT owner-only, and the card's own screen shows it to every
 * role -- an editor's way out of a newsroom is this control, and an editor who
 * could not reach it would need the owner to let them go.
 */
export function GiveUpTheDesk() {
  const { user, isPending } = useCurrentUserState();
  const email = user?.primaryEmail ?? "";
  return (
    <section className="mt-16 border-t border-rule pt-8 astra-jump" id="astra-give-up-the-desk">
      <SecHead
        title="Give up the desk"
        sub="Hands the newsroom to the next person who signs in: the archive, Dark Desk files, notes and Server controls. There is no way back. You will be asked to type your email address to confirm."
      />
      <div className="mt-4 max-w-2xl">
        {isPending ? (
          <p className="text-sm text-muted">Checking who you are…</p>
        ) : email ? (
          <LeaveEditorControl email={email} />
        ) : (
          <p className="text-sm text-muted">
            This needs the email address you signed in with, and it could not be read. Reload the
            page.
          </p>
        )}
      </div>
    </section>
  );
}
