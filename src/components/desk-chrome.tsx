import { Link, useMatchRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context";
import { UserButton } from "@/lib/auth/gates";
import { signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { leaveEditor } from "@/lib/news/claim";
import { createEditorCopy } from "@/lib/news/desk-copy";

const LINKS = [
  { to: "/desk", label: "Desk", exact: true },
  { to: "/desk/sources", label: "Sources" },
  { to: "/desk/scan", label: "Scan" },
  { to: "/desk/queue", label: "Queue" },
  { to: "/desk/published", label: "Published" },
  { to: "/desk/opinion", label: "Opinion" },
  { to: "/desk/ops", label: "Server" },
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
  const { formatDate } = usePaperDateFormatters();
  const { user, isPending } = useCurrentUserState();
  const { mode, choose } = useDeskMode();
  const { size, choose: chooseSize } = useDeskTextSize();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={deskShellClassName({ night, mode, size })}>
      <a href="#desk" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:bg-paper focus:px-3 focus:py-2 focus:text-sm focus:text-ink">
        Skip to desk
      </a>
      <header className="masthead">
        <div className="mast-row">
          <div className="mast-brand">
            <Link to="/" className="brand">
              {paper.name}
            </Link>
            <span className="brand-sub">
              {night ? "Dark Desk — investigates, never prints" : `Editor's desk — ${paper.city}`}
            </span>
          </div>
          <div className="mast-date">{formatDate(new Date())}</div>
          <div className="mast-tools">
            <Link to="/" className="mast-link">
              View paper
            </Link>
            {night ? null : (
            <div className="seg" role="group" aria-label="Light or dark">
              <button
                type="button"
                className={"seg-opt" + (mode === "light" ? " on" : "")}
                aria-pressed={mode === "light"}
                onClick={() => choose("light")}
              >
                Light
              </button>
              <button
                type="button"
                className={"seg-opt" + (mode === "dark" ? " on" : "")}
                aria-pressed={mode === "dark"}
                onClick={() => choose("dark")}
              >
                Dark
              </button>
            </div>
            )}
            {/*
              Text: Normal / Large. Shown even on the Dark Desk (which forces
              `night` and hides the Light/Dark seg above) -- readability is
              not the same axis as theme, and an editor on the Dark Desk at
              2am has the same eyes. See useDeskTextSize and the `.large`
              class / `--ts` custom property in styles.css.
            */}
            <div className="seg" role="group" aria-label="Text size">
              <button
                type="button"
                className={"seg-opt" + (size === "normal" ? " on" : "")}
                aria-pressed={size === "normal"}
                onClick={() => chooseSize("normal")}
              >
                Text: Normal
              </button>
              <button
                type="button"
                className={"seg-opt" + (size === "large" ? " on" : "")}
                aria-pressed={size === "large"}
                onClick={() => chooseSize("large")}
              >
                Large
              </button>
            </div>
            {isPending ? <span className="mast-user" aria-hidden /> : user ? <span className="mast-account"><UserButton /></span> : null}
          </div>
        </div>
        <div className="rule2" />
        <DeskNav />
        <div className="rule1" />
      </header>
      {/*
        An always-mounted live region.

        A screen reader announces a polite region reliably when the region was
        already in the document and only its text changed. Notices that mount
        together with their message often go unspoken, which is how async
        success and error feedback ended up inconsistently announced (UIUX-03).
        This region exists from first paint on every desk page; anything that
        wants to be heard can write into it.
      */}
      <div id="desk-announcer" className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
      <main id="desk" className="deskmain">
        {!hideTitle ? (
          <div className="ov-head">
            <div>
              <p className="kick">{kicker ?? "Newsroom"}</p>
              <h1 className="h1">{title}</h1>
            </div>
            {lede ? <div className="dark-lede">{lede}</div> : null}
          </div>
        ) : null}
        {children}
      </main>
    </div>
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

function DeskNav() {
  const matchRoute = useMatchRoute();
  /*
    Folded behind one "Menu" button on a phone (UX-001).

    At 375px the eight desk links wrapped to two rows of chrome between the
    masthead and the page heading — an editor triaging a scan from a phone
    paid that tax on every screen. Folded is not hidden: one tap shows every
    link, stacked; from 640px up the nav renders exactly as before.
  */
  const [open, setOpen] = useState(false);
  return (
    <nav className={"deskname" + (open ? " nav-open" : "")}>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Menu {open ? "▴" : "▾"}
      </button>
      {LINKS.map((l) => {
        const active = Boolean(
          matchRoute({ to: l.to, fuzzy: !("exact" in l && l.exact) }),
        );
        return (
          <Link
            key={l.to}
            to={l.to}
            onClick={() => setOpen(false)}
            className={"nav-item" + (active ? " on" : "")}
          >
            {l.label}
          </Link>
        );
      })}
      <span className="nav-sep" aria-hidden />
      <Link
        to="/desk/dark"
        onClick={() => setOpen(false)}
        className={"nav-item nav-dark" + (matchRoute({ to: "/desk/dark" }) ? " on" : "")}
      >
        Dark Desk
      </Link>
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
  tone?: "solid" | "ghost" | "danger" | "invert" | "quiet";
  type?: "button" | "submit";
  small?: boolean;
  ariaLabel?: string;
}) {
  const cls =
    "btn" +
    (tone === "solid" || tone === "invert" ? " solid" : "") +
    (tone === "danger" ? " danger" : "") +
    (tone === "quiet" ? " quiet" : "") +
    (small ? " small" : "");
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls} aria-label={ariaLabel}>
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

export function Chip({ s }: { s: string }) {
  const label = s === "aside" || s === "closed" || s === "exhausted" ? "set aside" : s;
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

export function leadOrigin(lead: {
  investigation_id?: number | null;
  why?: string;
  newsworthiness?: number | null;
}) {
  if (lead.investigation_id) return "from Dark Desk";
  if (/DARK DESK/i.test(lead.why ?? "")) return "from Dark Desk";
  if ((lead.newsworthiness ?? 0) > 0) return "from the scanner";
  return "filed by you";
}
