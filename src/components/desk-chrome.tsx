import { Link, useMatchRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePaper } from "@/lib/paper-context";
import { UserButton } from "@/lib/auth/gates";
import { signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { leaveEditor } from "@/lib/news/claim";
import { createEditorCopy } from "@/lib/news/desk-copy";

import {
  LayoutDashboard,
  Library,
  Radar,
  Inbox,
  Newspaper,
  PenLine,
  Settings,
  ChartNoAxesCombined,
  Search,
  Plus,
  Moon,
  Sun,
  Menu,
  X,
  ArrowUpRight,
  Telescope,
  MessagesSquare,
} from "lucide-react";
import { listLeads } from "@/lib/news/desk";
import { listEditorials } from "@/lib/news/opinion";

const NAV_ICONS = [
  LayoutDashboard,
  Library,
  Radar,
  Inbox,
  Newspaper,
  PenLine,
  Settings,
  ChartNoAxesCombined,
];
const LINKS = [
  { to: "/desk", label: "Desk", exact: true },
  { to: "/desk/sources", label: "Sources" },
  { to: "/desk/scan", label: "Scan" },
  { to: "/desk/queue", label: "Queue" },
  { to: "/desk/published", label: "Published" },
  { to: "/desk/opinion", label: "Opinion" },
  { to: "/desk/ops", label: "Server" },
  { to: "/desk/stats", label: "Stats" },
] as const;

const MODE_KEY = "townreporter.desk.mode";
const TEXT_SIZE_KEY = "townreporter.desk.textsize";

export const inkSolid =
  "pressable inline-flex min-h-11 items-center justify-center bg-ink px-4 text-sm font-medium text-paper hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50";
export const inkGhost =
  "pressable inline-flex min-h-11 items-center justify-center border border-ink px-4 text-sm font-medium hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-50";

function useDeskMode() {
  const [mode, setMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MODE_KEY);
      if (raw === "dark" || raw === "light") setMode(raw);
    } catch {
      /* ignore */
    }
  }, []);
  function choose(next: "light" | "dark") {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }
  return { mode, choose };
}

/**
 * Text: Normal / Large — mirrors useDeskMode's storage pattern exactly (same
 * key shape, same read-on-mount effect, same swallow-and-default-on-failure
 * behavior), so the two controls behave identically to an editor even though
 * one flips a class the theme owns and the other flips `.large`, which scales
 * every font-size this pass raised to the 14px/13px floor (see the `--ts`
 * custom property in styles.css). Defaults to Normal.
 */
function useDeskTextSize() {
  const [size, setSize] = useState<"normal" | "large">("normal");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEXT_SIZE_KEY);
      if (raw === "large" || raw === "normal") setSize(raw);
    } catch {
      /* ignore */
    }
  }, []);
  function choose(next: "normal" | "large") {
    setSize(next);
    try {
      localStorage.setItem(TEXT_SIZE_KEY, next);
    } catch {
      /* ignore */
    }
  }
  return { size, choose };
}

/**
 * Pure, exported for scripts/desk-text-size-render.test.mjs: the "light"
 * class the theme has always applied plus the "large" class this pass adds,
 * computed the same way DeskShell computes it. Kept as a named function
 * rather than inlined so a render test can assert the class list without
 * mounting a real DOM (no jsdom in this repo's test toolchain).
 */
export function deskShellClassName({
  night,
  mode,
  size,
}: {
  night?: boolean;
  mode: "light" | "dark";
  size: "normal" | "large";
}) {
  const nightPage = Boolean(night) || mode === "dark";
  return "desk-ltr" + (nightPage ? " night" : "") + (size === "large" ? " large" : "");
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
  const paper = usePaper();
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });
  const current =
    LINKS.find((l) => l.to === pathname)?.label ??
    (pathname.includes("story/") ? "Story workspace" : night ? "Dark Desk" : title);
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
          <span>EDITOR'S DESK · {paper.city}</span>
        </Link>
        <Link
          to="/desk"
          hash="story-composer"
          activeOptions={{ exact: true, includeHash: true }}
          className="btn solid astra-new"
          onClick={() => setMenuOpen(false)}
        >
          <Plus size={18} aria-hidden /> New story
        </Link>
        <DeskNav onNavigate={() => setMenuOpen(false)} />
        <div className="astra-account">
          <label className="astra-size">
            Text size{" "}
            <select
              aria-label="Text size"
              value={size}
              onChange={(e) => chooseSize(e.target.value as "normal" | "large")}
            >
              <option value="normal">Normal</option>
              <option value="large">Large</option>
            </select>
          </label>
          {isPending ? <span aria-hidden /> : user ? <UserButton /> : null}
        </div>
      </aside>
      <div className="astra-workspace">
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
          <div className="astra-breadcrumb">
            <Link to="/" title="Public news page">
              {paper.name}
            </Link>
            <span aria-hidden>/</span>
            <b>{current}</b>
          </div>
          <div className="astra-top-actions">
            <button
              className="astra-search-trigger"
              aria-label="Find anything"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
              <span>Find anything</span>
              <kbd>Ctrl K</kbd>
            </button>
            {!night && (
              <button
                className="astra-icon"
                aria-label={
                  mode === "dark" ? "Switch to light appearance" : "Switch to dark appearance"
                }
                onClick={() => choose(mode === "dark" ? "light" : "dark")}
              >
                {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            )}
            <Link to="/" className="astra-paper-link">
              Public news page <ArrowUpRight size={15} aria-hidden />
            </Link>
          </div>
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
    </div>
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
  const pages = [
    ...LINKS,
    { to: "/desk/dark", label: "Dark Desk" },
    { to: "/desk/follow-ups", label: "Follow-ups" },
    { to: "/desk/memory", label: "Beat memory" },
  ].filter((l) => l.label.toLocaleLowerCase().includes(query));
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
            <Link key={l.to} to={l.to} className="astra-search-result" onClick={onClose}>
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

function DeskNav({ onNavigate }: { onNavigate: () => void }) {
  const matchRoute = useMatchRoute();
  function item(l: (typeof LINKS)[number], index: number) {
    const Icon = NAV_ICONS[index];
    const active = Boolean(matchRoute({ to: l.to, fuzzy: !("exact" in l && l.exact) }));
    return (
      <Link
        key={l.to}
        to={l.to}
        activeOptions={{ exact: true }}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={"astra-nav" + (active ? " active" : "")}
      >
        <Icon size={18} aria-hidden />
        <span>{l.label}</span>
      </Link>
    );
  }
  return (
    <nav className="astra-navigation" aria-label="Editor's desk">
      <p className="astra-nav-label">Newsroom</p>
      {LINKS.slice(0, 6).map(item)}
      <p className="astra-nav-label">Reporting</p>
      <Link
        to="/desk/dark"
        onClick={onNavigate}
        className={"astra-nav" + (matchRoute({ to: "/desk/dark" }) ? " active" : "")}
      >
        <Telescope size={18} aria-hidden />
        <span>Dark Desk</span>
      </Link>
      <Link to="/desk/follow-ups" onClick={onNavigate} className="astra-nav">
        <MessagesSquare size={18} aria-hidden />
        <span>Follow-ups</span>
      </Link>
      <div className="astra-nav-bottom">{LINKS.slice(6).map((l, i) => item(l, i + 6))}</div>
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

export function Field({
  label,
  chip,
  hint,
  children,
}: {
  label: string;
  chip?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="f">
      <span className={chip ? "f-lab" : undefined}>
        {label}
        {chip ? <span className="chip dnp">{chip}</span> : null}
      </span>
      {children}
      {hint ? <p className="meta">{hint}</p> : null}
    </label>
  );
}

export const inputClass =
  "border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-2 focus:outline-offset-2 focus:outline-[var(--fg,var(--color-ink))] min-h-11";
export const areaClass =
  "border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-2 focus:outline-offset-2 focus:outline-[var(--fg,var(--color-ink))] min-h-11";

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

/**
 * Speaks through the always-mounted `#desk-announcer` live region above
 * (see the docstring on it): writing into text that's already in the
 * document, rather than mounting a notice together with its message, is
 * what makes a screen reader announce it reliably (UIUX-03). Model-picker.tsx
 * has its own private copy of the same function; this export exists so
 * newer call sites (the Follow-ups object) share one implementation.
 */
export function announceToDesk(text: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("desk-announcer");
  if (el) el.textContent = text;
}

export function leadOrigin(lead: {
  investigation_id?: number | null;
  scan_run_id?: number | null;
  why?: string;
  newsworthiness?: number | null;
}) {
  if (lead.investigation_id) return "from Dark Desk";
  if (/DARK DESK/i.test(lead.why ?? "")) return "from Dark Desk";
  if (lead.scan_run_id != null) return "from the scanner";
  if ((lead.newsworthiness ?? 0) > 0) return "from the scanner";
  return "filed by you";
}
