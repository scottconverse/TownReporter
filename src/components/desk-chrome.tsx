import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signOut } from "@/lib/auth/client";
import { leaveEditor } from "@/lib/news/claim";
import { listInvestigations } from "@/lib/news/dark";
import { createEditorCopy, openLeads, pileForStatus } from "@/lib/news/desk-copy";
import { isAgentKind, matchesFollowUpFilter } from "@/lib/news/follow-up-copy";
import { deskShellClassName } from "@/components/desk-chrome-utils";
import { DESK_NAV, SEARCH_PAGES, navItemIsActive } from "@/lib/desk-nav";
import { useAppearance } from "@/lib/appearance-context";
import { Dialog } from "@/components/dialog";
/*
  The drawn New-story dialog (Unit BN, item 1). `editor-dialogs.tsx` imports
  `InkButton` back from this file, so the two are a cycle; it is safe because
  both halves only reach for the other inside a function body -- neither
  evaluates the other at module scope -- and the real `vite build` is what
  proves it rather than this comment.
*/
import { NewStoryDialog } from "@/components/dialogs";
import { DeskToaster } from "@/components/desk-toaster";

import { Plus, Menu, X, ArrowUpRight } from "lucide-react";
import { jobHeadline } from "@/components/desk-jobs";
import { DeskJobCard } from "@/components/JobCard";
import { useDeskJobs } from "@/components/job-card-state";
import { listFollowUps, listLeads } from "@/lib/news/desk";
import { listEditorials } from "@/lib/news/opinion";
import type { JobProgressView } from "@/lib/news/job-progress";

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

  CY item 6: `count` is drawn on five of the items -- Queue, Drafts, Opinion,
  Follow-ups and Dark Desk (Desk Nav.dc.html:56) -- and every one of them is a
  number a desk screen already prints, computed by that screen's own rule
  rather than a second one invented here (see `counts`, below). Published is
  drawn blank, so it carries none. A count with no data yet shows nothing
  rather than a zero that looks like an answer.

  Unit U24: the LISTS themselves -- the drawer, the palette's pages and the
  active-item rule -- moved to `lib/desk-nav.ts`, so "every drawn screen has a
  drawn path to it" is a rule a test can read instead of one only a browser
  can. This file draws them, in the drawing's order and the drawing's words.
*/

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
  actions,
  hideTitle = false,
}: {
  children: React.ReactNode;
  title: string;
  kicker?: string;
  night?: boolean;
  lede?: React.ReactNode;
  /**
   * The page's own buttons, on the drawn header's right-hand end (README
   * "2. Today" / "3. Queue"): Today's "+ New story", the Queue's "Run scan
   * now". `lede` is the sentence that goes under the title; this is the row
   * that sits beside it, and the two are separate slots because the drawing
   * puts them in different places.
   */
  actions?: React.ReactNode;
  hideTitle?: boolean;
}) {
  const { mode, choose } = useDeskMode();
  const { size, choose: chooseSize } = useDeskTextSize();
  const [menuOpen, setMenuOpen] = useState(false);
  /*
    The nav's own New-story dialog (Unit BN, item 1). Held here rather than in
    each page: the button that opens it is in the shell's phone top bar, so one
    mount serves every desk screen.
  */
  const [newStoryOpen, setNewStoryOpen] = useState(false);
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

    FB1, unit 3: the box reads the ONE job query (`useDeskJobs`) rather than a
    reader of its own. It used to read `listRecentStoryWork`, which filtered
    `kind='draft'` -- so the nav's "Running · N" could not count a scan, a dig,
    a brief, a PDF read, a transcription or a routine edition, and the report's
    live walk found the box absent on all fourteen routes.

    `["leads"]` is the key every desk page already uses for `listLeads()`.

    CY item 6 adds three more keys to that list, and this comment used to claim
    otherwise ("nothing new is fetched that a desk screen was not already
    fetching"), so it says what is true now: `["editorials"]` and
    `["follow-ups","all"]` were until now only fetched when a reader asked for
    them -- the palette opens the first with `enabled: open` (DeskSearch,
    below), Today the second -- and `["investigations"]` was Today's alone. The
    shell now reads all three on every desk screen, because the nav it draws
    the counts on is on every desk screen. Nothing is written, and the keys are
    the existing ones, so an invalidation anywhere still refreshes them.
  */
  const jobs = useDeskJobs();
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads() });
  const editorials = useQuery({ queryKey: ["editorials"], queryFn: () => listEditorials() });
  const followUps = useQuery({
    queryKey: ["follow-ups", "all"],
    queryFn: () => listFollowUps({ data: {} }),
  });
  const investigations = useQuery({
    queryKey: ["investigations"],
    queryFn: () => listInvestigations(),
  });
  const running = (jobs.data ?? []).filter(
    (j) => j.status === "running" || j.status === "queued",
  );
  const allLeads = leads.data ?? [];
  /*
    THE FIVE DRAWN COUNTS, each one the number its own screen prints:

      Queue      `openLeads`, the same filter Today's and the Queue's own
                 headings count with (desk-copy.ts:437).
      Drafts     leads with status "drafted" -- what /desk/drafts lists.
      Opinion    every row /desk/opinion's "Requests & editorials" heading
                 counts (desk.opinion.tsx:474-482, `rows.length`).
      Follow-ups the Follow-ups screen's default tab: its agent rows that pass
                 `matchesFollowUpFilter(row,"active")` (desk.follow-ups.tsx:95
                 -101). The drawing's own nav says 5 and its Today rail says
                 "5 active" of the same set.
      Dark Desk  the investigations pile /desk/dark counts under the same name
                 ("Open files"), i.e. `pileForStatus(r.status) === "desk"`
                 (desk-copy.ts:412).

    Every entry is `undefined` until its query has data, which is what keeps a
    slow screen from printing a confident 0.
  */
  const counts: Record<string, number | undefined> = {
    Queue: allLeads.length ? openLeads(allLeads).length : undefined,
    Drafts: allLeads.length ? allLeads.filter((l) => l.status === "drafted").length : undefined,
    Opinion: editorials.data ? editorials.data.length : undefined,
    "Follow-ups": followUps.data
      ? followUps.data.filter(
          (row) => isAgentKind(row.agent_kind) && matchesFollowUpFilter(row, "active"),
        ).length
      : undefined,
    "Dark Desk": investigations.data
      ? investigations.data.filter((r) => pileForStatus(r.status) === "desk").length
      : undefined,
  };
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
        {/*
          CY item 6: the rail's "+ New story" (Unit BN2, item 5) is gone. The
          drawing has no such control in the desktop rail: `Desk Nav.dc.html`
          draws brand, running work, the eleven nav items and the footer
          (lines 23-45), and the only "+ New" in that file is the *phone* bar's
          (line 17). The drawn desktop create buttons are header actions --
          Today's three under its headline, the Queue's "Run scan now" -- so
          removing this leaves one door to `NewStoryDialog` on the phone bar
          (`.astra-bar-new`, above) and Today's own "+ New story" button. The
          shell still owns the one mount below, so both keep opening the same
          three tabs.
        */}
        <RunningBox jobs={running} onNavigate={() => setMenuOpen(false)} />
        {/*
          BF3, defect 3: the drawing has no "Find anything" box in the nav, so
          the drawn nav is brand, running work, the section list and the
          footer. Ctrl K is unchanged and still opens the palette -- the box
          was a second way to press a keyboard shortcut, and it was the only
          thing on the page that looked like a search field.
        */}
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
          <div className="astra-foot-row">
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
              Drawn as "Aa Large", not a text-size select: one button in the
              footer row that steps the desk between the two sizes. Like the
              Dark/Light control beside it, the label names what pressing it
              gets you, and `aria-pressed` carries the state the label cannot.
            */}
            <button
              type="button"
              className="astra-foot-btn"
              aria-pressed={size === "large"}
              aria-label={size === "large" ? "Switch to normal text" : "Switch to large text"}
              onClick={() => chooseSize(size === "large" ? "normal" : "large")}
            >
              {size === "large" ? "Aa Normal" : "Aa Large"}
            </button>
          </div>
          <button type="button" className="astra-foot-keys" onClick={() => setKeysOpen(true)}>
            Press ? for keyboard shortcuts
          </button>
          {/*
            BF3, defect 3: no "Scan the wire / Import" links under the footer.
            Those screens stay reachable -- the handoff (README "Existing
            routes to keep reachable") names /desk/import, /desk/memory and
            /desk/legal-removals -- so DESK_MORE is still the palette's page
            list below, and the footer draws only what the capture draws.
          */}
          {/*
            CY item 6: no account block in the rail. `Desk Nav.dc.html` ends the
            footer at "Press ? for keyboard shortcuts" (lines 40-44) -- no
            avatar, no email, no Sign out -- and the brief names it alongside
            "+ New story" as drawn-nowhere. Signing out stays reachable where
            the desk already keeps it: `LeaveEditorControl` on the Server page
            (`/desk/ops`, "the desk's own sign out", desk-chrome.tsx:714+) and
            the `UserButton` on the public paper's chrome. Recorded in
            design/SPEC-GAPS-0681.md.
          */}
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
          {/*
            Unit BN, item 1: the nav's New control opens the drawn New-story
            dialog (phase 4) instead of jumping to `#story-composer` on Today.
            It is the same button in the same place with the same words -- the
            drawing's phone bar is "Menu", the wordmark, a "Desk" tag and
            "+ New" -- so what changed is only what the press does: the three
            drawn tabs (AI drafts from material, write it myself, paste a
            finished story) open over the screen the editor is already on.

            `/desk/import` stays a route and stays in the palette's page list.
            Tab (a) of this dialog is that same intake -- the drawn dialog is
            the intake with the drop zone in front of it -- so the route is not
            superseded by it, it is what the dialog is made of. README
            "Existing routes to keep reachable" names it, and nothing here
            removes it.

            The drawer closes first on the phone: the nav is a modal panel
            there (`role="dialog"` above), and a dialog opened over an open
            drawer would land behind its scrim.
          */}
          <button
            type="button"
            className="btn solid astra-bar-new"
            aria-haspopup="dialog"
            onClick={() => {
              setMenuOpen(false);
              setNewStoryOpen(true);
            }}
          >
            <Plus size={18} aria-hidden /> New
          </button>
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
              {actions && <div className="head-acts">{actions}</div>}
            </div>
          )}
          {children}
        </main>
      </div>
      <DeskSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ShortcutSheet open={keysOpen} onClose={() => setKeysOpen(false)} />
      {/*
        Unit BN, item 1: the drawn New-story dialog, owned by the shell because
        the control that opens it is the nav's, so every desk screen gets it
        from one mount rather than each page carrying its own.
      */}
      <NewStoryDialog open={newStoryOpen} onClose={() => setNewStoryOpen(false)} />
      {/*
        FB5: the visible half of every announcement, mounted exactly once.
        A sibling of the announcer above and of the shell's dialogs rather than
        a child of <main>, so it is outside the scroll column and out of the
        grid the shell lays its nav and workspace out with. `announceToDesk`
        finds it by its host attribute and stops writing the sr-only region
        while it is here -- see `desk-toast.ts` for why only one of the two may
        speak. See `desk-toaster.tsx` for its position and z-index.
      */}
      <DeskToaster />
    </div>
  );
}

/**
 * THE RUNNING BOX. "A Running box, shown only while jobs are running. It has a
 * 2px yellow border, a pulsing 10px yellow square, 'Running · N', and each
 * job's title with elapsed time and current stage. Clicking it goes to Today."
 *
 * FB1, unit 3: each row is the DRAWN JobCard now, and the box counts every kind
 * rather than only drafts. The spec asks for "each job's title with elapsed time
 * and current stage" and the compact card is exactly that, plus the bar, the
 * chip row, the stall rule and Cancel -- which the hand-rolled row this
 * replaces could not show for any kind, including the draft it was written for.
 *
 * It reads the one `useDeskJobs()` query the whole desk shares (2s while
 * something is open, 30s when nothing is -- see `job-card-state.ts`), so the
 * shell, Today, the story page and Drafts all draw the same row from the same
 * request.
 *
 * The heading stays a link to Today, because that is what the drawing's box
 * does; the cards inside it carry their own press.
 */
function RunningBox({
  jobs,
  onNavigate,
}: {
  jobs: JobProgressView[];
  onNavigate: () => void;
}) {
  if (!jobs.length) return null;
  return (
    <div className="astra-running">
      <Link to="/desk" className="astra-running-head" onClick={onNavigate}>
        <span className="astra-running-dot" aria-hidden /> Running · {jobs.length}
      </Link>
      {jobs.slice(0, 3).map((job) => (
        <div className="astra-running-job" key={job.id}>
          {/*
            ONE TITLE, AND THE CARD IS WHAT CARRIES IT (FB1b, item 1).

            This used to draw the job's name as a bold line AND hand the same
            job to the card, whose first line is its name again -- "Scanning the
            watch list" twice in a row, then a title wrapping to three lines
            underneath it. The card's own title is the one that stays: it is
            single-line with an ellipsis in the compact variant, it carries the
            clock on its own column, and it is the same element on every other
            screen the card appears on.
          */}
          <DeskJobCard job={job} compact title={jobHeadline(job)} viewLabel="Open" />
        </div>
      ))}
    </div>
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
            <Link key={l.label} to={l.to} className="astra-search-result" onClick={onClose}>
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
            className={"astra-nav" + (l.sub ? " sub" : "") + (active ? " active" : "")}
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
  pending = false,
  pendingLabel,
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
  /**
   * FB5: the button is mid-press. It disables itself and draws
   * `pendingLabel` instead of its own word, which is the "Write draft →
   * Starting draft…" behaviour the desk already had in its composer and
   * almost nowhere else. `useDeskAction` (`desk-action.ts`) hands both of
   * these to the caller's `isPending`/`pendingLabel` so a press that takes
   * time does not look like a press that did nothing.
   */
  pending?: boolean;
  /** The word drawn while pending. Ignored unless `pending`. */
  pendingLabel?: React.ReactNode;
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
      disabled={disabled || pending}
      className={cls}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
    >
      {pending && pendingLabel != null ? pendingLabel : children}
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
  /**
   * Phase 2a (BF3): the lead row's menu holds the row's whole control set,
   * and two of those lines are not a word-and-a-handler -- "Kill as
   * duplicate" has three states, Delete asks before it acts, and the draft
   * line is a button beside its own model chooser. Those render here instead
   * of a `<button>`, so moving a control into the menu does not mean
   * rewriting the control. `label` is still required: it is the React key,
   * and the item's name in this list.
   */
  content?: ReactNode;
  /**
   * Stay open when pressed. A line that reveals the rest of its own question
   * ("Delete" -> "Yes, delete") is not a menu that has finished; closing on
   * the press would take the question away with it.
   */
  keepOpen?: boolean;
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
 * BN2 item 1 adds a third: which way the panel opens. It was `top: calc(100%
 * + 6px)` and nothing else, so on a row with less than the panel's height below
 * it -- the panel is ~414 px on a lead row -- the rows past the window's bottom
 * edge could not be pressed at all (measured: 0 of 7 rows hit their own element
 * on the last row of a six-lead Queue). The room below the summary is not
 * knowable in CSS, so it is measured here on open and `more-up` is set when the
 * panel is taller than that room; desk-astra.css hangs the panel from the
 * summary's top edge instead. The measurement happens with `more-up` removed,
 * so the height read is the panel's own and not a direction-dependent one.
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
  /**
   * Open upward when there is less room below the summary than the panel is
   * tall. Read after the browser has laid the open panel out, which is why it
   * runs from `onToggle` and not from the press that sets `open`.
   */
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("more-up");
    if (!el.open || typeof window === "undefined") return;
    const panel = el.querySelector(".more-menu");
    if (!(panel instanceof HTMLElement)) return;
    const room = window.innerHeight - el.getBoundingClientRect().bottom;
    if (panel.getBoundingClientRect().height > room) el.classList.add("more-up");
  }, []);
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
    <details className="more" ref={ref} onToggle={place}>
      <summary className="btn quiet more-sum" ref={summary} aria-label={ariaLabel}>
        {label} <span aria-hidden>▾</span>
      </summary>
      <ul className="more-menu">
        {items.map((item) =>
          item.content ? (
            <li key={item.label} className="more-block">
              {item.content}
            </li>
          ) : (
            <li key={item.label}>
              <button
                type="button"
                className={"more-item" + (item.danger ? " danger" : "")}
                disabled={item.disabled}
                onClick={() => {
                  if (ref.current && !item.keepOpen) ref.current.open = false;
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            </li>
          ),
        )}
      </ul>
    </details>
  );
}

export function Field({
  label,
  chip,
  hint,
  htmlFor,
  aside,
  className,
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
  /**
   * One sentence about the field, drawn at the right edge of the label row --
   * the story workbench's "A redraft will not replace it" (unit CW). It needs
   * `htmlFor`: see the branch below.
   *
   * It is a node rather than a string because the other thing the drawing puts
   * in that spot is the story editor's save line, which is not a sentence but
   * a live status: a `<span class="astra-save-state" role="status">`. What
   * matters is where the node lands -- a sibling of the label -- not what it
   * says, so both shapes are the caller's business.
   */
  aside?: React.ReactNode;
  /** Extra class on the wrapper, for a surface that styles its own labels. */
  className?: string;
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

    `aside` is the same trap one step further: it is a sentence about the
    field, not the field's name, so it is a sibling of the <label> and never
    a child of it. It is drawn in the `htmlFor` shape only -- the shape below
    has its control inside the label, where a sibling is not available and
    any text added is part of the name. No field on that shape passes one.
  */
  if (htmlFor) {
    const bound = <label htmlFor={htmlFor}>{wording}</label>;
    return (
      <div className={className ? `f ${className}` : "f"}>
        {aside ? (
          <div className="f-head">
            {bound}
            <span className="f-aside">{aside}</span>
          </div>
        ) : (
          bound
        )}
        {children}
        {tail}
      </div>
    );
  }
  return (
    <label className={className ? `f ${className}` : "f"}>
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
    /*
      FB5: a live region, because this sentence is the only thing the desk says
      while a screen's own long work is running and it was arriving unannounced
      (FB0-REPORT.md rows "Run scan now", "Keep digging", "Read selected pages").

      The wording is already the state ("Scanning sources…"), so `label` is the
      whole message and it is `aria-atomic` so the region reads as one sentence
      rather than as a fragment joining whatever was there before. Explicit
      `aria-live` for the reason `Notice` gives in states.tsx: an element that
      arrives together with its text is frequently not announced at all, which
      is why the desk's always-mounted `#desk-announcer` and the toast host
      exist beside it for the outcomes that must not be missed.
    */
    <div className="busy" role="status" aria-live="polite" aria-atomic="true">
      <div className="busy-rule" aria-hidden />
      <p className="busy-label">{label}</p>
    </div>
  );
}
