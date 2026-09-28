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
import { inviteEditor, myDesk, myRecoveryCodesStatus, regenerateRecoveryCodes } from "@/lib/news/claim";
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
import { getProviderStatuses } from "@/lib/news/provider-login";
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
import { CustomAiConnectionsPanel } from "@/components/custom-ai-connections-panel";

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

const SETTINGS_PANELS = [
  "Writing models",
  "Custom connections",
  "Daily scan",
  "Meeting capture",
  "YouTube",
  "Routine notices",
  "Paper identity",
  "Sections",
  "Named outlets",
  "Server health",
  "Recently deleted",
  "Editors & access",
] as const;
/**
 * Where each Server panel sits on the page.
 *
 * The drawing puts every panel on the page at once (Desk Screens.dc.html,
 * `isServer`), so "which panel am I looking at" is no longer state this screen
 * holds -- arriving with `#named-outlets` from another screen scrolls there
 * instead of selecting anything. These are the anchors the strip and the
 * hashes use; the writing-models and custom-ai-connections ids the panels
 * already carry in their own markup stay where they are.
 */
const PANEL_ANCHORS = {
  "Writing models": "ops-panel-writing-models",
  "Custom connections": "ops-panel-custom-connections",
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
} as const satisfies Record<(typeof SETTINGS_PANELS)[number], string>;

function jumpToPanel(anchor: string) {
  document.getElementById(anchor)?.scrollIntoView({ block: "start" });
}

function OpsPage() {
  const { signin } = Route.useSearch();
  const hash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    const anchor = signin
      ? PANEL_ANCHORS["Writing models"]
      : hash === "custom-ai-connections"
        ? PANEL_ANCHORS["Custom connections"]
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
    <DeskShell title="Server & newsroom" kicker="Models, health and setup" hideTitle>
      {/*
        The drawn header: kicker, title, the page's own action, rule -- the
        drawing puts "Give up the desk" on the title line, as the one thing on
        this screen that leaves the page. It is not a second control: it takes
        the editor to the section that holds it, which is the same button the
        panel has always drawn. The drawing's own style for it is `quiet` (one
        rule, not two): Desk Screens.dc.html, `btns.server`.

        The title stays "Server & newsroom", not the drawing's "Server":
        desk-flows-e2e.mjs waits on a level-1 heading named exactly that, and
        the drawing's short name is a *nav* label -- the rail in
        desk-chrome.tsx (lane 3), which still reads "Server", so renaming the
        h1 alone would make the rail and the page disagree.

        The lede moves out of the shell and into the body: `hideTitle` is what
        buys the action slot, and it drops the shell's sentence with the title,
        so the same prose is rendered here instead of being lost.
      */}
      <div className="astra-head">
        <div>
          <p className="kick">Models, health and setup</p>
          <h1 className="h1">Server &amp; newsroom</h1>
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
      <div className="astra-settings">
        <nav className="astra-settings-nav" aria-label="Server settings">
          {SETTINGS_PANELS.map((name) => (
            <button key={name} onClick={() => jumpToPanel(PANEL_ANCHORS[name])}>
              {name}
            </button>
          ))}
        </nav>
        <div className="astra-settings-body">
          <div className="astra-ops-col">
            <div
              className="astra-ops-card astra-panel astra-jump"
              id={PANEL_ANCHORS["Writing models"]}
            >
              <WritingModels />
            </div>
            <div
              className="astra-ops-card astra-panel astra-jump"
              id={PANEL_ANCHORS["Recently deleted"]}
            >
              <RecentlyDeleted />
            </div>
            <div className="astra-ops-card astra-panel astra-jump" id={PANEL_ANCHORS["Daily scan"]}>
              <DailyScanSettings />
            </div>
            <div className="astra-ops-card astra-panel astra-jump" id={PANEL_ANCHORS.YouTube}>
              <YoutubeKeySettings />
            </div>
            <div
              className="astra-ops-card astra-panel astra-jump"
              id={PANEL_ANCHORS["Named outlets"]}
            >
              <NamedOutletsSetup />
            </div>
            <div
              className="astra-ops-card astra-panel astra-jump"
              id={PANEL_ANCHORS["Custom connections"]}
            >
              <CustomAiSettings />
            </div>
            {/*
              The rest of column one is chosen by height, not by the drawing's
              row pairs. These are the full panels, not the drawing's compact
              summaries, and a card cannot be split across the two columns --
              with the drawing's pairing the left column ended several thousand
              pixels above the right one and the page finished with a blank
              half-screen. Paper setup and Routine notices are the two that
              bring the columns out within a couple of hundred pixels.
            */}
            <div
              className="astra-ops-card astra-panel astra-jump"
              id={PANEL_ANCHORS["Paper identity"]}
            >
              <PaperSetup />
            </div>
            <div
              className="astra-ops-card astra-panel astra-jump"
              id={PANEL_ANCHORS["Routine notices"]}
            >
              <RoutineNoticePermissions />
            </div>
          </div>
          <div className="astra-ops-col">
            <div
              className="astra-ops-card astra-panel astra-jump"
              id={PANEL_ANCHORS["Server health"]}
            >
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

              <section className="mt-12">
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

              <section className="mt-12">
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
            </div>
            <div className="astra-ops-card astra-panel astra-jump" id={PANEL_ANCHORS.Sections}>
              <SectionsSetup />
            </div>
            <div
              className="astra-ops-card astra-panel astra-jump"
              id={PANEL_ANCHORS["Meeting capture"]}
            >
              <MeetingCaptureSettings />
            </div>
            <div
              className="astra-ops-card astra-panel astra-jump"
              id={PANEL_ANCHORS["Editors & access"]}
            >
              <InviteAnEditor />
              <RecoveryCodesPanel />
              <GiveUpTheDesk />
            </div>
          </div>
        </div>
      </div>
    </DeskShell>
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
 * not merely hidden here.
 */
function CustomAiSettings() {
  /*
    The panel itself moved to src/components/custom-ai-connections-panel.tsx in
    unit BG, so the Models screen draws the same cards with the same wiring.
    This wrapper keeps the section's place on the page -- the anchor an editor
    has bookmarked, and the rule that separates it from the panel above.
  */
  return (
    <div id="custom-ai-connections" className="mt-12 min-w-0 border-t border-rule pt-8">
      <CustomAiConnectionsPanel />
    </div>
  );
}

function WritingModels() {
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const { signin } = Route.useSearch();
  const [note, setNote] = useState("");
  const isOwner = me.data?.role === "owner";

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

  if (!isOwner) return null;

  return (
    <section className="mt-8" id="writing-models" ref={scrollHere}>
      <SecHead
        title="Writing models"
        aside={
          <InkButton
            tone="quiet"
            onClick={() => void statuses.refetch()}
            disabled={statuses.isFetching}
          >
            {statuses.isFetching ? "Checking…" : "Check now"}
          </InkButton>
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
        cannot advertise an order the desk no longer has.
      */}
      <p className="mt-4 max-w-2xl text-sm text-ink-2">{automaticOrderSentence()}</p>
      {/*
        Unit BG: the summary the redesign pairs with this panel -- which model
        runs which job, and its fallbacks, is one screen of its own now. The
        link is how an owner gets there from Server settings; the new desk
        navigation carries the same destination (README line 364).
      */}
      <p className="mt-3 text-base">
        <Link to="/desk/models" className="inline-link">
          Assign models to jobs →
        </Link>
      </p>
      {statuses.isPending ? (
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
            />
          ))}
        </ul>
      )}
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
        These are the command-line tools TownReporter drafts with. Being signed in to claude.ai in
        your browser or the Claude desktop app is a separate login and does not count here.
      </p>
    </section>
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

/**
 * Owner recovery codes (Unit CJ, 0.6.80).
 *
 * Pattern matched to CivicCast's admin recovery codes (see recovery-codes.ts
 * for the file:line search and the one deliberate count difference): one-time
 * codes, shown once, with an explicit "I saved these" confirm before the download
 * button and the raw list disappear from state -- there is no "show them
 * again" here on purpose, matching the codes themselves (each one-time).
 * Owner-only: `myRecoveryCodesStatus`/`regenerateRecoveryCodes` both 403 a
 * non-owner server-side; this component also just returns null for one, the
 * same shape `InviteAnEditor` above uses.
 */
function RecoveryCodesPanel() {
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const status = useQuery({
    queryKey: ["recovery-codes-status"],
    queryFn: () => myRecoveryCodesStatus(),
    enabled: me.data?.role === "owner",
  });
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const mint = useMutation({
    mutationFn: () => regenerateRecoveryCodes(),
    onSuccess: (r) => {
      setErr(null);
      setSaved(false);
      setCodes(r.codes);
      void qc.invalidateQueries({ queryKey: ["recovery-codes-status"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not generate recovery codes."),
  });
  if (me.data?.role !== "owner") return null;

  function downloadCodes() {
    if (!codes) return;
    const blob = new Blob(
      [
        `TownReporter recovery codes\n` +
          `Generated ${new Date().toISOString()}\n` +
          `Each code works once. Keep this file somewhere safe, off this machine.\n\n` +
          codes.join("\n") +
          "\n",
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "townreporter-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mt-16 border-t border-rule pt-8" id="astra-recovery-codes">
      <SecHead
        title="Recovery codes"
        sub="If you lose the password to this account, one of these codes gets you back in: it sets a one-time temporary password on your account, which you use to sign in and then change. Each code works once. Generating a new set retires the old one immediately."
      />
      <div className="mt-4 max-w-2xl space-y-3">
        <p className="text-sm text-muted">
          {codes
            ? // A fresh set was just minted this screen -- all of it is unused,
              // even before the status query's background refetch lands.
              `${codes.length} of ${codes.length} unused codes remain from the current set.`
            : status.data
              ? `${status.data.remaining} of 10 unused codes remain from the current set.`
              : "Checking your current codes…"}
        </p>
        {err ? <p className="text-sm text-rust">{err}</p> : null}
        {!codes ? (
          <InkButton disabled={mint.isPending} onClick={() => mint.mutate()}>
            {mint.isPending
              ? "Generating…"
              : status.data && status.data.remaining > 0
                ? "Generate new recovery codes (retires the old set)"
                : "Generate recovery codes"}
          </InkButton>
        ) : (
          <div className="border border-rule bg-paper-2 p-3">
            <p className="astra-label">Shown once — save these now</p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
              />
              I saved these somewhere safe.
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <InkButton tone="quiet" disabled={!saved} onClick={downloadCodes}>
                Download as .txt
              </InkButton>
              <InkButton
                tone="quiet"
                disabled={!saved}
                onClick={() => {
                  setCodes(null);
                  setSaved(false);
                }}
              >
                Done
              </InkButton>
            </div>
            {!saved ? (
              <p className="mt-2 text-sm text-muted">
                Confirm you saved these before leaving this screen — they will not be shown again.
              </p>
            ) : null}
          </div>
        )}
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
