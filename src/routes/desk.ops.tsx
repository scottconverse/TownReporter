import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeskShell, Field, InkButton, LeaveEditorControl, SecHead } from "@/components/desk-chrome";
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
import { SectionsSetup } from "@/components/sections-setup";
import { NamedOutletsSetup } from "@/components/named-outlets-setup";
import { getPaperConfigForEditor } from "@/lib/news/paper-settings";
import { getDarkCounty, saveDarkCounty } from "@/lib/news/dark";
/*
  Only the statuses read lives here now: the sign-in card itself moved to
  src/components/provider-status-card.tsx in unit BG, because the Models
  screen draws the same card under "Subscription sign-ins (OAuth)" and two
  copies of a countdown would drift.
*/
import { getProviderStatuses, type ProviderStatus } from "@/lib/news/provider-login";
import { getProviderTimeSettings } from "@/lib/news/provider-settings";
/*
  The two bounds come from the PURE registry module, not from
  provider-settings.ts: this is a client component, and the registry is the
  half with no database handle, no `node:` imports and nothing to leak into
  the browser bundle.
*/
import { ProviderTimeField } from "@/components/provider-time-field";
import { editorActionError, inviteMessage } from "@/lib/news/desk-copy";
import { automaticOrderSentence } from "@/lib/news/model-choice";
import { localModelCatalog, refreshLocalModelCatalog } from "@/lib/news/provider-availability";
import { DailyScanSettings } from "@/components/daily-scan-settings";
import { MeetingCaptureSettings } from "@/components/meeting-capture-settings";
import { RoutineNoticePermissions } from "@/components/routine-notice-permissions";
import { YoutubeKeySettings } from "@/components/youtube-key";
import { XaiOauthConnection } from "@/components/xai-oauth-connection";
import { ProviderStatusCard } from "@/components/provider-status-card";
import { Chip } from "@/components/status-chip";

export const Route = createFileRoute("/desk/ops")({
  head: () => ({ meta: [{ title: "Server — TownReporter" }] }),
  /*
    `?signin=claude` is how the Sign in button on a failed draft hands over:
    it starts the login and sends the editor here. Anything else in that slot
    is dropped rather than trusted -- it decides what this page scrolls to and
    announces, and it arrives from the address bar.
  */
  validateSearch: (search: Record<string, unknown>): { signin?: "claude" | "codex" } => ({
    signin: search.signin === "claude" || search.signin === "codex" ? search.signin : undefined,
  }),
  component: OpsPage,
});

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

function StateDot({ state }: { state: HealthState }) {
  return (
    <span className="chip">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[state]}`} aria-hidden />{" "}
      {WORD[state]}
    </span>
  );
}

/**
 * Where each Server card sits on the page.
 *
 * The drawing puts every card on the page at once (Desk Screens.dc.html,
 * `isServer`), so "which panel am I looking at" is not state this screen holds
 * -- arriving with `#named-outlets` from another screen scrolls there instead
 * of selecting anything. These are the ids the hashes and the header action
 * use; the `writing-models` id the panel carries in its own markup stays where
 * it is, because the desk rail links to it.
 *
 * Unit CX removed the jump strip these anchors used to feed. The ids stay:
 * `scripts/named-outlets-e2e.mjs` and `scripts/sections-source-add-e2e.mjs`
 * visit `/desk/ops#outlets` and `/desk/ops#sections`, and a hash that scrolls
 * nowhere is a broken bookmark.
 */
const PANEL_ANCHORS = {
  "Writing models": "ops-panel-writing-models",
  "Daily scan": "ops-panel-daily-scan",
  "Meeting capture": "ops-panel-meeting-capture",
  YouTube: "ops-panel-youtube",
  "Routine notices": "ops-panel-routine-notices",
  "Paper identity": "ops-panel-paper-identity",
  Sections: "ops-panel-sections",
  "Named outlets": "ops-panel-named-outlets",
  "Server health": "ops-panel-server-health",
  "Recently deleted": "ops-panel-recently-deleted",
  "Editors & access": "ops-panel-editors-access",
  "Time budgets": "ops-panel-time-budgets",
} as const;

function jumpToPanel(anchor: string) {
  document.getElementById(anchor)?.scrollIntoView({ block: "start" });
}

function OpsPage() {
  const { signin } = Route.useSearch();
  const hash = useRouterState({ select: (s) => s.location.hash });

  /*
    Who is reading the page.

    Unit CX: the drawing gives every card a read-only face for editors who are
    not the owner, and the panels behind four of these cards are owner-only on
    the server (health, writing models, time budgets, meeting capture). Asking
    once here and passing the answer down is what lets a card say "only the
    owner can read this" in words instead of rendering a skeleton that never
    resolves, or a panel that throws on a refusal it cannot explain.
  */
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const known = me.isSuccess;
  const isOwner = me.data?.role === "owner";
  const [showLogs, setShowLogs] = useState(false);
  const [showActions, setShowActions] = useState(false);

  useEffect(() => {
    const anchor = signin
      ? PANEL_ANCHORS["Writing models"]
      : /*
          "#custom-ai-connections" used to land on a panel of its own on this
          page. Unit CX moved that panel to the Models screen's second tab --
          the drawn Writing models card links to it as "All connections" -- so
          the old bookmark now lands on the card that carries the link. A
          hash that scrolls nowhere is a broken bookmark; one that scrolls to
          the door is a slightly stale bookmark, which is what it is.
        */
        hash === "custom-ai-connections"
        ? PANEL_ANCHORS["Writing models"]
        : // "#youtube-key" is the key box; checked before the substring tests
          // below so a link to it cannot be swallowed by a wider match.
          hash === "youtube-key"
          ? PANEL_ANCHORS.YouTube
          : // "#named-outlets" opens the outlet list; a link that wants
            // Sections still says "section", which the outlets hash does not
            // contain.
            hash.includes("outlet")
            ? PANEL_ANCHORS["Named outlets"]
            : hash.includes("section")
              ? PANEL_ANCHORS.Sections
              : null;
    // After paint, so the panel is laid out before we scroll to it.
    if (anchor) requestAnimationFrame(() => jumpToPanel(anchor));
  }, [signin, hash]);
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<OpsActionId | null>(null);
  const [message, setMessage] = useState<string>("");
  const [running, setRunning] = useState<OpsActionId | null>(null);

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
    <DeskShell title="Server" kicker="Models, health and setup" hideTitle>
      {/*
        The drawn header: kicker, title, the page's own action, rule -- the
        drawing puts "Give up the desk" on the title line, as the one thing on
        this screen that leaves the page. It is not a second control: it takes
        the editor to the card that holds it, which is the same button the panel
        has always drawn. The drawing's own style for it is `quiet` (one rule,
        not two): Desk Screens.dc.html, `btns.server`.

        The title is the drawing's "Server" (unit CX). It read "Server &
        newsroom" before, on the argument that the rail's label and the h1
        should agree -- but the rail says "Server" (desk-chrome.tsx, DESK_NAV),
        so the rename is what makes the two agree, and the drawing is the
        authority. The kicker keeps the words that were doing the explaining.

        The lede moves out of the shell and into the body: `hideTitle` is what
        buys the action slot, and it drops the shell's sentence with the title,
        so the same prose is rendered here instead of being lost.
      */}
      <div className="astra-head">
        <div>
          <p className="kick">Models, health and setup</p>
          <h1 className="h1">Server</h1>
        </div>
        <div className="astra-head-acts">
          <button
            type="button"
            className="btn quiet"
            onClick={() => {
              jumpToPanel(PANEL_ANCHORS["Editors & access"]);
            }}
          >
            Give up the desk
          </button>
        </div>
      </div>
      <p className="lede">
        Everything this machine is doing to keep the paper online, and the few buttons worth having.
        Checks show what responds from this machine; they do not prove that a reader in another town
        can reach your paper.
      </p>
      {/*
        The drawn grid (Desk Screens.dc.html, `isServer`): ONE two-column grid
        with Writing models spanning both rows on the left and the remaining
        cards flowing after it, in the order the drawing lists them. Unit CX
        removed the twelve-button jump strip that used to sit here -- the
        drawing has no tab pills, and with one card per panel the strip was a
        second list of what the page already shows.

        Card order below IS the drawn order. The page used to pick its column
        order by height, which is what put Recently deleted at the top of the
        page and Health down a second column.
      */}
      <div className="astra-settings">
        <div className="astra-settings-body">
          <OpsCard id={PANEL_ANCHORS["Writing models"]} tall>
            <WritingModels isOwner={isOwner} known={known} />
          </OpsCard>
          <OpsCard id={PANEL_ANCHORS["Server health"]}>
            {known && !isOwner ? (
              <ReadOnlyNote>
                Only the owner can read this machine&rsquo;s health, its logs and the buttons that
                restart things. Ask the owner if a check looks wrong.
              </ReadOnlyNote>
            ) : (
              <>
              <section className="mt-12">
                <SecHead
                  title="Health"
                  aside={
                    <span className="flex items-center gap-4">
                      <StateDot state={state} />
                      <InkButton
                        tone="quiet"
                        onClick={() => void health.refetch()}
                        disabled={health.isFetching}
                      >
                        {health.isFetching ? "Checking…" : "Check now"}
                      </InkButton>
                    </span>
                  }
                  sub={
                    health.data
                      ? `${health.data.host} · read ${formatAgo(health.data.takenAt)}`
                      : undefined
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

              {/*
                The drawing's two buttons at the foot of the Health card
                (Desk Screens.dc.html, `panels[0].btns`): "View logs" and
                "Restart workers". Neither has a screen of its own, and the
                drawing gives the two panels behind them no other door -- so
                they are disclosures, not links: the panel opens in place,
                under the button that asked for it, and every control inside
                still works exactly as it did when the panels stood alone.
                Both are recorded in design/SPEC-GAPS-0681.md (CX).

                `aria-expanded`/`aria-controls` rather than InkButton, which
                takes no aria props: a disclosure that a screen reader cannot
                tell is open is a control that lies about its state.
              */}
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
                        {unavailable ? (
                          <p className="mt-2 text-sm">Unavailable: {unavailable}</p>
                        ) : null}
                        <p className="mt-1 text-sm text-muted">
                          Takes about {a.expectSeconds} seconds.
                        </p>
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
            )}
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS["Paper identity"]}>
            {known && !isOwner ? (
              <ReadOnlyNote>
                Only the owner can change the paper&rsquo;s name, town, state, timezone and starting
                watch list.
              </ReadOnlyNote>
            ) : (
              <PaperSetup />
            )}
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS["Recently deleted"]}>
            <RecentlyDeleted />
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS.Sections}>
            {known && !isOwner ? (
              <ReadOnlyNote>
                Only the owner can add, rename, hide or retire a section. The sections themselves
                are the rail on every desk page and the headings on the public paper.
              </ReadOnlyNote>
            ) : (
              <SectionsSetup />
            )}
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS["Daily scan"]}>
            {known && !isOwner ? (
              <ReadOnlyNote>
                Only the owner can change when the daily scan runs and how much it may read. It
                runs for the whole paper, once.
              </ReadOnlyNote>
            ) : (
              <DailyScanSettings />
            )}
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS["Meeting capture"]}>
            {known && !isOwner ? (
              <ReadOnlyNote>
                Only the owner can configure meeting capture. The card is here so the page still
                says what the desk watches.
              </ReadOnlyNote>
            ) : (
              <MeetingCaptureSettings />
            )}
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS.YouTube}>
            <YoutubeKeySettings />
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS["Routine notices"]}>
            <RoutineNoticePermissions />
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS["Named outlets"]}>
            {known && !isOwner ? (
              <ReadOnlyNote>
                Only the owner can change the named outlets and their overrides. Everything the
                desk writes still uses them.
              </ReadOnlyNote>
            ) : (
              <NamedOutletsSetup />
            )}
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS["Editors & access"]}>
            {known ? (
              <>
                {isOwner ? (
                  <InviteAnEditor />
                ) : (
                  <ReadOnlyNote>
                    Only the owner can invite an editor or hand the newsroom over. Your own way out
                    is below.
                  </ReadOnlyNote>
                )}
                {/*
                  Never owner-only: this is the control an editor uses to LEAVE,
                  and the owner uses to hand the newsroom on. It stays on this
                  card for everyone (unit CX item 2: never delete a working
                  owner control).
                */}
                <GiveUpTheDesk />
              </>
            ) : null}
          </OpsCard>

          <OpsCard id={PANEL_ANCHORS["Time budgets"]}>
            <TimeBudgets />
          </OpsCard>
        </div>
      </div>
    </DeskShell>
  );
}

/**
 * One card of the Server grid.
 *
 * The drawing draws this page as a plain two-column grid of boxes, each one a
 * panel with its title inside (Desk Screens.dc.html, `isServer`: the outer
 * `div` is the grid, the `sc-for` over `panels` draws the boxes). No tab
 * pills, no jump strip, no accordion -- every card is on the page at once, so
 * "which panel am I looking at" is not a question this screen asks.
 *
 * `.astra-panel` is the shipped card (surface, 1px rule, 18/20 padding), so a
 * card here is the same box every other panel on the desk is. The id is what
 * the old anchors and the header's one action scroll to.
 *
 * `tall` is the drawing's `grid-row:span 2` on Writing models -- the one card
 * that is twice as long as its neighbours. It is reset to `auto` in the
 * one-column media query, where spanning two rows would leave a hole.
 */
function OpsCard({
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
 * What a card says to an editor who is not the owner.
 *
 * Unit CX item 4. Four of these cards read something only the owner may read
 * (this machine's health, the writing models' sign-ins, the time budgets, the
 * meeting settings), and the server refuses the read rather than trusting the
 * UI to hide it. Before, the card drew its loading skeleton and stayed there:
 * "◉UNKNOWN" over grey bars, which reads as a broken page rather than a
 * permission. One plain sentence is the honest answer, and it is a sentence an
 * editor can act on -- ask the owner.
 */
function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 max-w-2xl text-base text-ink-2" data-testid="ops-read-only">
      {children}
    </p>
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
function TimeBudgets() {
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
 */
function WritingModels({ isOwner, known }: { isOwner: boolean; known: boolean }) {
  const { signin } = Route.useSearch();
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
   * Which time fields belong under which sign-in row. Both Codex models are
   * the one Codex login; Claude Opus is the one Claude login.
   */
  const timesFor = (provider: string) =>
    (times.data ?? []).filter((row) =>
      provider === "codex"
        ? row.kind === "codex"
        : row.kind === "claude-code" || row.kind === "anthropic",
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

  /*
    The two doors the drawing puts at the foot of this card: the yellow
    "Assign models to jobs →" and the outlined "All connections" (Desk
    Screens.dc.html, `models` card, both wired to `goModels`). They replace
    the one inline text link this panel used to carry -- same destination,
    drawn as the drawing draws them, and the pair is the card's whole footer
    for an owner and for an editor alike, because a door is not a control:
    the Models screen has its own read-only face.
  */
  const doors = (
    <div className="mt-5 flex flex-wrap gap-2">
      <Link to="/desk/models" className="btn solid">
        Assign models to jobs →
      </Link>
      <Link to="/desk/models" search={{ tab: "conn" }} className="btn">
        All connections
      </Link>
    </div>
  );

  return (
    <section className="mt-8" id="writing-models" ref={scrollHere}>
      <SecHead
        title="Writing models"
        aside={
          isOwner ? (
            <InkButton
              tone="quiet"
              onClick={() => void statuses.refetch()}
              disabled={statuses.isFetching}
            >
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
              times={timesFor(s.provider)}
              chip={<WritingModelChip status={s} />}
            />
          ))}
        </ul>
      )}
      {doors}
      {isOwner ? (
        <>
          <XaiOauthConnection onNote={setNote} />
          {/*
            Providers with no sign-in row of their own.

            A configured gateway (LLM_BASE_URL) has no login to manage here -- it
            is an endpoint the operator pointed at -- but it is the door a local
            model comes through today, and a local model is the exact case that
            needs a longer per-call ceiling. Without this block the one provider
            that most needs its timeout raised would be the one provider with no
            field. Shown only when the machine actually has it.
          */}
          {(times.data ?? [])
            .filter(
              (row) =>
                !["claude-code", "anthropic", "codex", "xai-oauth"].includes(row.kind) &&
                row.availableOnThisMachine,
            )
            .map((row) => (
              <div key={row.providerId} className="astra-panel">
                <h3 className="font-display text-lg font-semibold">{row.label}</h3>
                <p className="mt-1 text-sm text-ink-2">
                  {row.detail}. No sign-in to manage here: this one is configured by the operator.
                </p>
                <ProviderTimeField row={row} onNote={setNote} />
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
function WritingModelChip({ status }: { status: ProviderStatus }) {
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
function LocalModelCatalogTable({ onNote }: { onNote: (text: string) => void }) {
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
function RecentlyDeleted() {
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
 * The one irreversible thing on this page, kept furthest from everything else.
 *
 * It used to be a button in the header of every desk page. See
 * LeaveEditorControl in desk-chrome.tsx for what an audit found when it walked
 * that path. It belongs here, at the bottom of the page an operator visits on
 * purpose, and nowhere else.
 */
/**
 * Invite a second editor (v0.5.3). Owner-only, enforced server-side; the UI
 * simply does not render the form for an invited editor. The minted link is
 * shown ONCE -- the server stores only a hash -- so the owner copies it here
 * and hands it over however they like. It expires in seven days, works for
 * exactly the named address, and burns on use.
 */
/**
 * CITY-SETUP final slice: the same setup form as the first-run gate
 * (src/routes/desk.setup.tsx), reachable again here so a mistake made
 * during setup -- the wrong timezone, a typo in the city -- is fixable
 * without touching a file. Owner-only, same as Invite an editor below.
 */
function PaperSetup() {
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
function DarkDeskCounty() {
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

function InviteAnEditor() {
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
            <p className="astra-label">
              Shown once — copy it now
            </p>
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
                <p className="astra-label">
                  Ready-to-send message
                </p>
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

function GiveUpTheDesk() {
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
