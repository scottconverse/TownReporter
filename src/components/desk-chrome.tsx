import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserButton } from "@/lib/auth/gates";
import { signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { leaveEditor } from "@/lib/news/claim";
import { createEditorCopy, openLeads } from "@/lib/news/desk-copy";
import { deskShellClassName } from "@/components/desk-chrome-utils";
import { useAppearance } from "@/lib/appearance-context";
import { Dialog } from "@/components/dialog";

import { Search, Plus, Menu, X, ArrowUpRight } from "lucide-react";
import { elapsedLabel, useNowMs, type RunningJob } from "@/components/desk-jobs";
import { listLeads, listRecentStoryWork } from "@/lib/news/desk";
import { listEditorials } from "@/lib/news/opinion";

/*
  THE NAV, IN THE REDESIGN'S ORDER AND THE REDESIGN'S WORDS.

  docs/design/handoff-2026-09-26/README.md, "Shell for all desk screens":
  Today, Queue, Drafts, Published, Opinion, Follow-ups, Dark Desk,
  Sources & scan, Models, Server, Stats. It replaced an eight-item list that
  had no Drafts (the new list screen), called Today "Desk", and merged
  models into "Server".

  No icons. design-system/README.md §9 ("Icons: avoid them. Words are
  clearer… always next to a text label") and the DeskNav reference component
  both draw the nav as a word with a count at the right, so the lucide glyphs
  the old nav carried are gone rather than kept as decoration.

  Two items share one route: "Models" is the existing model-assignment panel
  on the Server page (`#writing-models` in desk.ops.tsx), and "Server" is that
  page itself. The phase-1 unit reports this honestly instead of inventing a
  /desk/models screen the app does not have; the hash is what tells the two
  apart for the active item, below.

  `count` is only ever set from data a desk page already polls (leads, jobs).
  A designed count with no query behind it shows nothing rather than a zero
  that looks like an answer.
*/
type DeskNavItem = {
  to: string;
  label: string;
  /** Active only on an exact path match — the page the item names. */
  exact?: boolean;
  /** A hash the link carries, when two items share one route. */
  hash?: string;
};

const DESK_NAV: readonly DeskNavItem[] = [
  { to: "/desk", label: "Today", exact: true },
  { to: "/desk/queue", label: "Queue" },
  { to: "/desk/drafts", label: "Drafts" },
  { to: "/desk/published", label: "Published" },
  { to: "/desk/opinion", label: "Opinion" },
  { to: "/desk/follow-ups", label: "Follow-ups" },
  { to: "/desk/dark", label: "Dark Desk" },
  { to: "/desk/sources", label: "Sources & scan" },
  { to: "/desk/ops", label: "Models", hash: "writing-models" },
  { to: "/desk/ops", label: "Server" },
  { to: "/desk/stats", label: "Stats" },
] as const;

/** Routes the shell no longer draws as nav items, kept reachable in the footer. */
const DESK_MORE = [
  { to: "/desk/scan", label: "Scan the wire" },
  { to: "/desk/import", label: "Import" },
  { to: "/desk/memory", label: "Beat memory" },
  { to: "/desk/legal-removals", label: "Legal removals" },
] as const;

/**
 * Which nav item is current. `pathname` alone cannot answer it any more,
 * because Models and Server are the same route; the hash decides between them
 * when there is one, and Server — the page — wins when there is not.
 */
function navItemIsActive(item: DeskNavItem, pathname: string, hash: string) {
  const path = item.to;
  const onPath = item.exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
  if (!onPath) return false;
  if (path !== "/desk/ops") return true;
  const wantHash = `#${item.hash ?? ""}`;
  return item.hash ? hash === wantHash : hash !== "#writing-models";
}

/**
 * Search pages list. The old one read `LINKS`, so a rebuilt nav with new
 * routes and new words silently changed what "Find a story or screen" could
 * find; this is the same list the nav draws, plus the screens that are now
 * only in the footer.
 */
const SEARCH_PAGES = [...DESK_NAV, ...DESK_MORE].map((l) => ({ to: l.to, label: l.label }));

/*
  Light/Dark and Normal/Large both come from AppearanceProvider now.

  They used to be two copy-pasted hooks here, each with its own copy of the
  storage key and its own read-on-mount `useEffect` -- which is why both of
  them applied a paint late, and why the shell was light for a frame on every
  reload in dark mode. The provider reads the same two keys, and the head
  script in __root.tsx has already painted them from localStorage before this
  component exists; see src/lib/appearance.ts.

  These two wrappers keep the call sites below reading the way they did
  (`mode` / `choose`, `size` / `chooseSize`) so nothing else has to change.
  The `choose` functions write straight through to storage -- no local state
  to drift from it.
*/
function useDeskMode() {
  const { appearance, setDesk } = useAppearance();
  return {
    mode: appearance.desk,
    choose: (next: "light" | "dark") => setDesk({ desk: next }),
  };
}

/**
 * Text: Normal / Large — the `.large` class the shell already carried, and now
 * also the `data-desk-size` attribute the stylesheets key on (see the `--ts`
 * custom property in styles.css), which scales every font-size this pass raised
 * to the 14px/13px floor. Defaults to Normal.
 */
function useDeskTextSize() {
  const { appearance, setDesk } = useAppearance();
  return {
    size: appearance.size,
    choose: (next: "normal" | "large") => setDesk({ size: next }),
  };
}

export function DeskShell({
  children,
  title,
  kicker,
  night = false,
  lede,
  hideTitle = false,
}: {
  children: React.ReactNode;
  title: string;
  kicker?: string;
  night?: boolean;
  lede?: React.ReactNode;
  hideTitle?: boolean;
}) {
  const { user, isPending } = useCurrentUserState();
  const { mode, choose } = useDeskMode();
  const { size, choose: chooseSize } = useDeskTextSize();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const changed = () => setMobile(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!mobile || !menuOpen) return;
    const sidebar = document.getElementById("desk-navigation");
    const items = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),select") ?? [],
      );
    items()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
      if (event.key !== "Tab") return;
      const all = items();
      const first = all[0];
      const last = all.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [mobile, menuOpen]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });
  /*
    THE RUNNING BOX'S DATA, and the nav's counts.

    `["recent-story-work"]` is the key `/desk` already polls, so the shell and
    the page share one in-flight request and one cache entry. `["leads"]` is
    the key every desk page already uses for `listLeads()`. Nothing new is
    fetched that a desk screen was not already fetching; the shell only reads
    it.
  */
  const jobs = useQuery({
    queryKey: ["recent-story-work"],
    queryFn: () => listRecentStoryWork(),
    refetchInterval: 5000,
  });
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads() });
  const running = (jobs.data ?? []).filter(
    (j) => j.status === "running" || j.status === "queued",
  ) as RunningJob[];
  const allLeads = leads.data ?? [];
  const counts: Record<string, number | undefined> = {
    Queue: allLeads.length ? openLeads(allLeads).length : undefined,
    Drafts: allLeads.length
      ? allLeads.filter((l) => l.status === "drafted").length
      : undefined,
    Published: allLeads.length
      ? allLeads.filter((l) => l.status === "published").length
      : undefined,
  };
  const nowMs = useNowMs(running.length > 0);
  useEffect(() => {
    setMenuOpen(false);
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") setMenuOpen(false);
      /*
        "?" opens the shortcut list from any desk screen, which is what the
        nav footer promises. Ignored while the editor is typing, so a question
        mark in a headline or a note stays a question mark.
      */
      const target = e.target as HTMLElement | null;
      const typing =
        target?.isContentEditable === true ||
        (target ? /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) : false);
      if (e.key === "?" && !typing) {
        e.preventDefault();
        setKeysOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <div
      className={deskShellClassName({ night, mode, size }) + " astra"}
      data-desk-page={pathname.split("/")[2] || "home"}
    >
      <a href="#desk" className="astra-skip">
        Skip to desk
      </a>
      {menuOpen && (
        <button
          className="astra-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        id="desk-navigation"
        inert={mobile && !menuOpen}
        aria-label="Newsroom navigation"
        role={mobile && menuOpen ? "dialog" : undefined}
        aria-modal={mobile && menuOpen ? true : undefined}
        className={"astra-sidebar" + (menuOpen ? " is-open" : "")}
      >
        <button
          className="astra-icon astra-sidebar-close"
          aria-label="Close navigation"
          onClick={() => {
            setMenuOpen(false);
            menuButton.current?.focus();
          }}
        >
          <X size={20} />
        </button>
        <Link to="/" className="astra-brand" title="Public news page">
          <strong>TownReporter</strong>
          <span>Editor’s desk</span>
        </Link>
        <RunningBox jobs={running} nowMs={nowMs} onNavigate={() => setMenuOpen(false)} />
        <button
          type="button"
          className="astra-nav astra-find"
          onClick={() => {
            setMenuOpen(false);
            setSearchOpen(true);
          }}
        >
          <Search size={18} aria-hidden />
          <span>Find anything</span>
          <kbd>Ctrl K</kbd>
        </button>
        <DeskNav
          onNavigate={() => setMenuOpen(false)}
          counts={counts}
          pathname={pathname}
          hash={hash}
        />
        <div className="astra-nav-foot">
          <Link to="/" className="astra-foot-paper" title="Public news page">
            View the paper ↗
          </Link>
          {!night && (
            <button
              type="button"
              className="astra-foot-btn"
              aria-label={
                mode === "dark" ? "Switch to light appearance" : "Switch to dark appearance"
              }
              onClick={() => choose(mode === "dark" ? "light" : "dark")}
            >
              {mode === "dark" ? "Light" : "Dark"}
            </button>
          )}
          {/*
            The design draws this as "Aa Large" — one control that cycles the
            two steps. screen-reader-wise and test-wise the desk has always had
            a labelled <select> here (scripts/desk-text-size-render.test.mjs
            pins `aria-label="Text size"` and both options), so the select
            stays and is drawn at the footer control height instead.
          */}
          <label className="astra-size">
            Text size
            <select
              aria-label="Text size"
              value={size}
              onChange={(e) => chooseSize(e.target.value as "normal" | "large")}
            >
              <option value="normal">Normal</option>
              <option value="large">Large</option>
            </select>
          </label>
          <button type="button" className="astra-foot-btn" onClick={() => setKeysOpen(true)}>
            Press ? for keyboard shortcuts
          </button>
          <div className="astra-foot-more">
            {DESK_MORE.map((l) => (
              <Link key={l.to} to={l.to} onClick={() => setMenuOpen(false)}>
                {l.label}
              </Link>
            ))}
          </div>
          <div className="astra-account">
            {isPending ? <span aria-hidden /> : user ? <UserButton /> : null}
          </div>
        </div>
      </aside>
      <div className="astra-workspace">
        {/*
          PHONE ONLY. The design puts the whole navigation in the drawer and
          gives the top bar four things: "Menu", the wordmark, a "Desk" tag and
          "+ New" ("Shell for all desk screens" → "Phone: the nav collapses to
          a top bar…"). On the desktop grid the nav column is always on screen,
          so a second strip above the page carried a breadcrumb nobody needed
          and a theme toggle that now lives in the nav footer.
        */}
        <header className="astra-topbar">
          <button
            ref={menuButton}
            className="astra-icon astra-menu"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            aria-controls="desk-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={20} />
          </button>
          <Link to="/" className="astra-brand astra-brand-bar" title="Public news page">
            <strong>TownReporter</strong>
            <span>Desk</span>
          </Link>
          <Link to="/desk" hash="story-composer" className="btn solid astra-bar-new">
            <Plus size={18} aria-hidden /> New
          </Link>
        </header>
        <div
          id="desk-announcer"
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        />
        <main id="desk" className="deskmain" tabIndex={-1}>
          {!hideTitle && (
            <div className="ov-head">
              <div>
                <p className="kick">{kicker ?? "Newsroom"}</p>
                <h1 className="h1">{title}</h1>
              </div>
              {lede && <div className="dark-lede">{lede}</div>}
            </div>
          )}
          {children}
        </main>
      </div>
      <DeskSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ShortcutSheet open={keysOpen} onClose={() => setKeysOpen(false)} />
    </div>
  );
}

/**
 * THE RUNNING BOX. "A Running box, shown only while jobs are running. It has a
 * 2px yellow border, a pulsing 10px yellow square, 'Running · N', and each
 * job's title with elapsed time and current stage. Clicking it goes to Today."
 *
 * It reads the same `listRecentStoryWork` query the desk already polls
 * (5s, the interval README "Interactions & behavior" sets for Today lists),
 * through the same query key as `/desk` — one request, two readers, no new
 * endpoint and nothing written.
 *
 * Elapsed is measured from `started_at` (set when a worker claims the job) and
 * falls back to `updated_at` while the job is still queued, so a queued row
 * counts from when it was filed rather than from 0:00 forever. The one-second
 * ticker only runs while something is running.
 */
function RunningBox({
  jobs,
  nowMs,
  onNavigate,
}: {
  jobs: RunningJob[];
  nowMs: number;
  onNavigate: () => void;
}) {
  if (!jobs.length) return null;
  return (
    <Link to="/desk" className="astra-running" onClick={onNavigate}>
      <b className="astra-running-head">
        <span className="astra-running-dot" aria-hidden /> Running · {jobs.length}
      </b>
      {jobs.slice(0, 3).map((job) => (
        <span className="astra-running-job" key={job.id}>
          <b>{job.headline}</b>
          <span>
            {elapsedLabel(job, nowMs)} · {job.stage || "Waiting to start"}
          </span>
        </span>
      ))}
    </Link>
  );
}

/**
 * The shortcut sheet behind "?" . Every line is a key the desk actually binds
 * somewhere: the triage keys on Today, ⌘S in the story workbench, Ctrl-K for
 * search here. ⌘S is listed because README "Interactions & behavior" lists it
 * and it is bound on the workbench, not because the shell intercepts it.
 *
 * H and X said "— asks why" until this pass, which was not true of any screen
 * in the desk: the hold and kill presses set the status and nothing asks
 * anything (phase 4 adds the reasons). A sheet whose whole job is telling the
 * editor what a key does cannot promise a prompt that never comes.
 */
const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "J / K", what: "Next / previous lead" },
  { keys: "S", what: "Start a story from the selected lead" },
  { keys: "H", what: "Hold the selected lead" },
  { keys: "X", what: "Kill the selected lead" },
  { keys: "U", what: "Put the selected lead back to new" },
  { keys: "Enter", what: "Open the selected lead" },
  { keys: "N", what: "Start a new story" },
  { keys: "⌘S", what: "Save in the story workbench" },
  { keys: "?", what: "This list" },
  { keys: "Esc", what: "Close this list or the phone menu" },
];

function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      subtitle="Keys are ignored while you are typing in a box."
      primaryLabel="Got it"
      onPrimary={onClose}
      cancelLabel="Close"
    >
      <dl className="astra-keys">
        {SHORTCUTS.map((s) => (
          <div key={s.keys}>
            <dt>
              <kbd>{s.keys}</kbd>
            </dt>
            <dd>{s.what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
function DeskSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads(), enabled: open });
  const editorials = useQuery({
    queryKey: ["editorials"],
    queryFn: () => listEditorials(),
    enabled: open,
  });
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      searchInput.current?.focus();
    } else dialog.current?.close();
  }, [open]);
  const query = term.trim().toLocaleLowerCase();
  const pages = SEARCH_PAGES.filter((l) => l.label.toLocaleLowerCase().includes(query));
  const matches = (leads.data ?? [])
    .filter((l) =>
      `${l.story_headline ?? ""} ${l.headline} ${l.why} ${l.topic}`
        .toLocaleLowerCase()
        .includes(query),
    )
    .slice(0, 30);
  const opinionMatches = (editorials.data ?? [])
    .filter(
      (r) =>
        r.draft_id &&
        `${r.headline ?? ""} ${r.subject} opinion`.toLocaleLowerCase().includes(query),
    )
    .slice(0, 30);
  return (
    <dialog
      ref={dialog}
      className="astra-dialog"
      onClose={onClose}
      aria-labelledby="desk-search-title"
    >
      <div className="astra-dialog-head">
        <h2 id="desk-search-title">Find a story or screen</h2>
        <button className="astra-icon" aria-label="Close search" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="astra-dialog-body">
        <label className="field">
          <span>Search your newsroom</span>
          <input
            ref={searchInput}
            autoFocus
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Headlines, topics, queue, settings…"
          />
        </label>
        <nav aria-label="Search results">
          {pages.map((l) => (
            <Link
              key={l.label}
              to={l.to}
              className="astra-search-result"
              onClick={onClose}
            >
              {l.label}
              <ArrowUpRight size={16} />
            </Link>
          ))}
          {leads.isError && (
            <p role="alert">
              Stories could not load.{" "}
              <button className="btn" onClick={() => void leads.refetch()}>
                Try again
              </button>
            </p>
          )}
          {leads.isPending && <p role="status">Loading stories…</p>}
          {editorials.isError && (
            <p role="alert">
              Editorials could not load.{" "}
              <button className="btn" onClick={() => void editorials.refetch()}>
                Try again
              </button>
            </p>
          )}
          {matches.map((l) => (
            <Link
              key={l.id}
              to="/desk/story/$leadId"
              params={{ leadId: String(l.id) }}
              className="astra-search-result"
              onClick={onClose}
            >
              <span>
                {l.story_headline || l.headline}
                <small>
                  {l.topic} · {l.status}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </Link>
          ))}
          {opinionMatches.map((r) => (
            <Link
              key={`opinion-${r.id}`}
              to="/desk/story/draft/$draftId"
              params={{ draftId: String(r.draft_id) }}
              className="astra-search-result"
              onClick={onClose}
            >
              <span>
                {r.headline || r.subject}
                <small>opinion · {r.published_slug ? "published" : "draft"}</small>
              </span>
              <ArrowUpRight size={16} />
            </Link>
          ))}
          {!leads.isPending &&
            !editorials.isPending &&
            !leads.isError &&
            !editorials.isError &&
            !matches.length &&
            !opinionMatches.length &&
            !pages.length && <p>No matches. Try a name, topic or part of a headline.</p>}
        </nav>
      </div>
    </dialog>
  );
}

/**
 * Give up the desk. Lives on the Server page, and asks you to type your address.
 *
 * This was a button in the header of every desk page, two positions from
 * "Sign out", behind one inline confirm. An audit walked it: click, confirm,
 * and the newsroom belongs to the next anonymous visitor to /login -- archive,
 * Dark Desk files, reporting notes, and the Server controls that restart
 * services on the journalist's machine. No password reset exists, so there was
 * no way back from inside the product, and the desk is reachable from the
 * internet through the tunnel.
 *
 * Three things changed. It moved off the chrome, so it is not adjacent to an
 * action people click without reading. The confirmation describes the
 * consequence rather than the mechanism. And it asks for the email address of
 * the account you are signed in as -- which is also enforced by the server, so
 * removing this input would not reopen the door.
 */
export function LeaveEditorControl({ email }: { email: string }) {
  const [ask, setAsk] = useState(false);
  const [typed, setTyped] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const copy = createEditorCopy();
  const leave = useMutation({
    mutationFn: async () => {
      const res = await leaveEditor({ data: typed });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["desk-claim"] });
      await qc.invalidateQueries({ queryKey: ["my-desk"] });
      try {
        await signOut();
      } catch {
        /* still go back to the paper */
      }
      await navigate({ to: "/" });
    },
  });

  if (!ask) {
    return (
      <button type="button" className="leave-editor" onClick={() => setAsk(true)}>
        {copy.leave}
      </button>
    );
  }

  // Compared here only to disable the button early. The server checks it too,
  // and the server's check is the one that matters.
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  return (
    <div className="leave-ask">
      <p>{copy.confirm}</p>
      <label htmlFor="leave-confirm-email">Your email address</label>
      <input
        id="leave-confirm-email"
        type="email"
        autoComplete="off"
        value={typed}
        placeholder={email}
        onChange={(e) => setTyped(e.target.value)}
      />
      {typed && !matches ? <p role="alert">{copy.mismatch}</p> : null}
      {leave.isError ? <p role="alert">{(leave.error as Error).message}</p> : null}
      <button
        type="button"
        className="leave-yes"
        disabled={!matches || leave.isPending}
        onClick={() => leave.mutate()}
      >
        {leave.isPending ? "Leaving…" : copy.confirmYes}
      </button>
      <button
        type="button"
        className="leave-no"
        disabled={leave.isPending}
        onClick={() => {
          setAsk(false);
          setTyped("");
        }}
      >
        {copy.confirmNo}
      </button>
    </div>
  );
}

function DeskNav({
  onNavigate,
  counts,
  pathname,
  hash,
}: {
  onNavigate: () => void;
  counts: Record<string, number | undefined>;
  pathname: string;
  hash: string;
}) {
  return (
    <nav className="astra-navigation" aria-label="Editor’s desk">
      {DESK_NAV.map((l) => {
        const count = counts[l.label];
        const active = navItemIsActive(l, pathname, hash);
        return (
          <Link
            key={l.label}
            to={l.to}
            hash={l.hash}
            activeOptions={{ exact: true, includeHash: Boolean(l.hash) }}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={"astra-nav" + (active ? " active" : "")}
          >
            <span>{l.label}</span>
            {count != null ? <span className="astra-nav-count">{count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function InkButton({
  children,
  onClick,
  disabled,
  tone = "solid",
  type = "button",
  small = false,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /**
   * "danger" is a confirm-step destructive action -- always rendered solid
   * too, so it does not look like the same low-emphasis outline as the
   * Cancel/Keep button next to it ("Yes, delete", "Yes, do it").
   *
   * "quiet-danger" is Kill: a real action, not a confirm step, that still
   * needs to read as heading toward removal rather than as a neutral
   * secondary action like Hold or Back sitting right beside it. It keeps
   * quiet's low-emphasis footprint (no solid fill) but must still carry a
   * visible warn border and text -- see the `.btn.quiet.danger` override
   * in styles.css, which exists because `.btn.quiet`'s `border-color:
   * transparent` and `.btn.danger`'s `border-color: var(--warn)` are equal
   * specificity, and only a combined selector reliably wins that tie.
   */
  tone?: "solid" | "ghost" | "danger" | "invert" | "quiet" | "quiet-danger";
  type?: "button" | "submit";
  small?: boolean;
  ariaLabel?: string;
}) {
  const cls =
    "btn" +
    (tone === "solid" || tone === "invert" || tone === "danger" ? " solid" : "") +
    (tone === "danger" || tone === "quiet-danger" ? " danger" : "") +
    (tone === "quiet" || tone === "quiet-danger" ? " quiet" : "") +
    (small ? " small" : "");
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cls}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

/** One line of a "More ▾" menu: a word, and what it does. */
export type DeskMoreItem = {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** A remove-or-stop action. The word is already the warning; this only
   *  colors it, so a Kill in a menu reads the same as a Kill on a row. */
  danger?: boolean;
};

/**
 * "More ▾" — the row menu the redesign draws on Queue, Drafts and Published.
 *
 * There is no popover or menu component in this codebase. `<details>` is the
 * house idiom for one (`model-picker`, `sections-setup`, and the model
 * chooser on every lead row), so this reuses it rather than adding a
 * positioning library and a portal: the browser supplies open/close,
 * keyboard operation, focus order and the `aria-expanded` state for free.
 *
 * The two things `<details>` does not supply are added here, because a menu
 * that stays open after a click and does not close on Escape is a trap:
 * a pointerdown outside closes it, and Escape closes it and puts focus back
 * on the summary so the keyboard does not land at the top of the document.
 *
 * This is a disclosure, not an ARIA `menu`: a real `menu` role has to own
 * arrow-key movement between items, and claiming the role without that is a
 * worse experience than a plain list of buttons. It is a `<ul>` of buttons.
 */
export function DeskMoreMenu({
  label = "More",
  items,
  ariaLabel,
}: {
  label?: string;
  items: DeskMoreItem[];
  /** What this menu acts on, for a screen reader: "More actions for <headline>". */
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    const outside = (event: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event.target instanceof Node && el.contains(event.target)) return;
      el.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      const el = ref.current;
      if (event.key !== "Escape" || !el?.open) return;
      el.open = false;
      summary.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details className="more" ref={ref}>
      <summary className="btn quiet more-sum" ref={summary} aria-label={ariaLabel}>
        {label} <span aria-hidden>▾</span>
      </summary>
      <ul className="more-menu">
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              className={"more-item" + (item.danger ? " danger" : "")}
              disabled={item.disabled}
              onClick={() => {
                if (ref.current) ref.current.open = false;
                item.onSelect?.();
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Field({
  label,
  chip,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  chip?: string;
  hint?: string;
  /**
   * Set when the label must name a control it does not contain -- the story
   * screen's headline box, whose "Edit" hint is painted inside the box and so
   * had to stop being a descendant of the label. See the branch below.
   */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const wording = (
    <>
      {label}
      {chip ? <span className="chip dnp">{chip}</span> : null}
    </>
  );
  const tail = hint ? <p className="meta">{hint}</p> : null;
  /*
    TWO SHAPES, ONE FIELD (AH5).

    The usual one wraps everything in the <label>, so the control inside is
    named by the label's text. That is a trap for any field that paints words
    beside its control: a browser builds the accessible name out of a label's
    whole text, so the story headline -- a textarea with a decorative "Edit"
    <span> inside `.astra-headline-box` -- was announced as "Headline Edit",
    and an exact `getByRole("textbox", { name: "Headline" })` could no longer
    find it. Measured in Chromium, with `aria-describedby` pointing at the
    span: name "Headline Edit". `aria-describedby` does not keep text out of
    the name; only not being inside the label does.

    A field that passes `htmlFor` therefore gets the other shape: a plain
    wrapper holding the label (bound to its control by id) and then the
    control and the hint beside it, outside it. That field's name is its
    label; the "Edit" span stays reachable as the control's description. The
    wrapper keeps the class `f`, so the CSS that positions the label text is
    the only thing that has to know about the second shape (desk-astra.css).
  */
  if (htmlFor) {
    return (
      <div className="f">
        <label htmlFor={htmlFor}>{wording}</label>
        {children}
        {tail}
      </div>
    );
  }
  return (
    <label className="f">
      <span className={chip ? "f-lab" : undefined}>{wording}</span>
      {children}
      {tail}
    </label>
  );
}

export function Score({ v }: { v: number }) {
  return (
    <span
      className={"score" + (v >= 14 ? " hot" : v >= 10 ? " warm" : "")}
      title={"Newsworthiness " + v + "/20"}
    >
      {v}
    </span>
  );
}

const CHIP_LABELS: Record<string, string> = {
  aside: "set aside",
  closed: "closed",
  exhausted: "exhausted",
};

/**
 * Every real status renders its own word, styled -- nothing falls through to
 * the unstyled default look. "held", "aside", "closed", and "exhausted" used
 * to collapse onto one shared "set aside" label (or, for "held", no styled
 * chip at all besides the generic `.chip` gray), which read as the same
 * status even though an editor treats them differently: held is coming back,
 * aside/closed/exhausted are done. The visible word is uppercased by the
 * `.chip` CSS rule (text-transform), so "held" already renders HELD.
 */
export function Chip({ s }: { s: string }) {
  const label = CHIP_LABELS[s] ?? s;
  return <span className={"chip st-" + s}>{label}</span>;
}

export function SecHead({
  title,
  count,
  aside,
  sub,
}: {
  title: string;
  count?: number | string | null;
  aside?: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="sechead">
      <div className="sechead-l">
        {/*
          h2, not h3. The page heading is an h1 and these are its sections, so
          jumping to h3 left a gap that a screen-reader user navigating by
          heading level reads as a missing level. Audit finding UIUX-04.
        */}
        <h2 className="sec-title">{title}</h2>
        {count != null ? <span className="sec-count">{count}</span> : null}
      </div>
      {aside || null}
      {sub ? <p className="sec-sub">{sub}</p> : null}
    </div>
  );
}

export function Busy({ label }: { label: string }) {
  return (
    <div className="busy">
      <div className="busy-rule" />
      <p className="busy-label">{label}</p>
    </div>
  );
}

/*
  ===========================================================================
  LANE-2 PLACEHOLDER — REPLACE THIS WITH THE REAL JOB CARD.
  ===========================================================================

  The redesign draws a Job card (README "Job card anatomy"): title, model ·
  effort, elapsed in m:ss, a stage list with a check for each finished stage and
  a yellow fill on the current one, a progress bar, the current step, "Last
  activity m:ss ago", and a state — Running / Stalled / Done / Failed, each with
  its own actions. The compact variant (no stage list, 12px padding) is what
  Drafts draws inline on a running row.

  Lane 2 owns that card, and is building it against the same `desk_jobs` rows
  this reads. Until it lands, this stands in: a `RunningJob`'s title, elapsed
  time and current `stage` text inside a dashed outline, so a stand-in can
  never be mistaken at a glance for the drawn card, in a screenshot or in the
  code.

  ONE SWAP POINT. Today's "Running now" and "In progress", and Drafts' running
  rows, all render `<JobSlot>` and nothing else; when lane 2's `JobCard` exists,
  this function's body becomes `<JobCard job={job} compact={compact} />` and
  those three screens need no change at all. `data-job-slot` marks each one in
  the DOM so the stand-ins are countable.

  It shows only what the desk already polls: no fake progress bar, no invented
  stage list, no model name it was not given. A placeholder that fakes the
  missing half would hide the fact that it is missing.
*/
export function JobSlot({ job, nowMs, compact = false }: { job: RunningJob; nowMs: number; compact?: boolean }) {
  return (
    <div className={"job-slot" + (compact ? " job-slot-compact" : "")} data-job-slot="">
      <b className="job-slot-title">{job.headline}</b>
      <span className="job-slot-meta">
        {elapsedLabel(job, nowMs)} · {job.stage || "Waiting to start"}
      </span>
    </div>
  );
}
