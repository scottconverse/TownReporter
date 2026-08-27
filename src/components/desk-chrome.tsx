import { Link, useMatchRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatDate, PAPER } from "@/lib/paper";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const LINKS = [
  { to: "/desk", label: "Desk", exact: true },
  { to: "/desk/sources", label: "Sources" },
  { to: "/desk/scan", label: "Scan" },
  { to: "/desk/queue", label: "Queue" },
  { to: "/desk/published", label: "Published" },
] as const;

const MODE_KEY = "townreporter.desk.mode";

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
  const nightPage = night || mode === "dark";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={"desk-ltr" + (nightPage ? " night" : "")}>
      <a href="#desk" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:bg-paper focus:px-3 focus:py-2 focus:text-sm focus:text-ink">
        Skip to desk
      </a>
      <header className="masthead">
        <div className="mast-row">
          <div className="mast-brand">
            <Link to="/" className="brand">
              {PAPER.name}
            </Link>
            <span className="brand-sub">
              {night ? "Dark Desk — investigates, never prints" : `Editor's desk — ${PAPER.city}`}
            </span>
          </div>
          <div className="mast-date">{formatDate(new Date())}</div>
          <div className="mast-tools">
            <Link to="/" className="mast-link">
              View paper
            </Link>
            <div className="seg" role="group" aria-label="Light or dark">
              <button
                type="button"
                className={"seg-opt" + (mode === "light" ? " on" : "")}
                onClick={() => choose("light")}
              >
                Light
              </button>
              <button
                type="button"
                className={"seg-opt" + (mode === "dark" ? " on" : "")}
                onClick={() => choose("dark")}
              >
                Dark
              </button>
            </div>
            {isPending ? <span className="mast-user" aria-hidden /> : user ? <span className="mast-account"><UserButton /></span> : null}
          </div>
        </div>
        <div className="rule2" />
        <DeskNav />
        <div className="rule1" />
      </header>
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

function DeskNav() {
  const matchRoute = useMatchRoute();
  return (
    <nav className="deskname">
      {LINKS.map((l) => {
        const active = Boolean(
          matchRoute({ to: l.to, fuzzy: !("exact" in l && l.exact) }),
        );
        return (
          <Link key={l.to} to={l.to} className={"nav-item" + (active ? " on" : "")}>
            {l.label}
          </Link>
        );
      })}
      <span className="nav-sep" aria-hidden />
      <Link
        to="/desk/dark"
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "solid" | "ghost" | "danger" | "invert" | "quiet";
  type?: "button" | "submit";
  small?: boolean;
}) {
  const cls =
    "btn" +
    (tone === "solid" || tone === "invert" ? " solid" : "") +
    (tone === "danger" ? " danger" : "") +
    (tone === "quiet" ? " quiet" : "") +
    (small ? " small" : "");
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="f">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inputClass = "";
export const areaClass = "";

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
        <h3 className="sec-title">{title}</h3>
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
