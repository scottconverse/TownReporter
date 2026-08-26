import { Link, useMatchRoute } from "@tanstack/react-router";
import { PAPER } from "@/lib/paper";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const LINKS = [
  { to: "/desk", label: "Overview", exact: true },
  { to: "/desk/sources", label: "Sources" },
  { to: "/desk/scan", label: "Scan" },
  { to: "/desk/queue", label: "Queue" },
  { to: "/desk/dark", label: "Dark desk" },
  { to: "/desk/memory", label: "Memory" },
] as const;

export const inkSolid =
  "pressable inline-flex min-h-11 items-center justify-center bg-ink px-4 text-sm font-medium text-paper hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50";
export const inkGhost =
  "pressable inline-flex min-h-11 items-center justify-center border border-ink px-4 text-sm font-medium hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-50";

export function DeskShell({
  children,
  title,
  kicker,
  night = false,
}: {
  children: React.ReactNode;
  title: string;
  kicker?: string;
  night?: boolean;
}) {
  const { user, isPending } = useCurrentUserState();
  return (
    <div
      className={
        night ? "min-h-dvh bg-ink text-paper" : "min-h-dvh bg-desk text-desk-ink"
      }
    >
      <a
        href="#desk"
        className={
          night
            ? "sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:bg-paper focus:px-3 focus:py-2 focus:text-sm focus:text-ink"
            : "sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
        }
      >
        Skip to desk
      </a>
      <header
        className={
          night ? "border-b border-ink-2 bg-ink" : "border-b border-ink bg-paper"
        }
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <Link
              to="/"
              className="font-display text-lg font-semibold transition-[color] duration-150 ease-out hover:text-rust"
            >
              {PAPER.name}
            </Link>
            <p
              className={`text-[11px] tracking-[0.16em] uppercase ${night ? "text-paper-2" : "text-muted"}`}
            >
              {night
                ? "Dark desk — investigative engine"
                : "Editor-in-chief desk"}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link
              to="/"
              className={
                night
                  ? "inline-flex min-h-11 items-center text-paper-2 transition-[color] duration-150 ease-out hover:text-paper"
                  : "inline-flex min-h-11 items-center text-muted transition-[color] duration-150 ease-out hover:text-ink"
              }
            >
              View paper
            </Link>
            {isPending ? (
              <div
                className={
                  "h-8 w-8 rounded-full " +
                  (night
                    ? "skeleton-rule skeleton-rule-night"
                    : "skeleton-rule")
                }
                aria-hidden
              />
            ) : user ? (
              <UserButton />
            ) : null}
          </div>
        </div>
        <DeskNav night={night} />
      </header>
      <main id="desk" className="mx-auto max-w-6xl scroll-mt-4 px-4 py-8 sm:px-6">
        <div className="stagger-in">
          <p className="text-[11px] tracking-[0.16em] text-rust uppercase">
            {kicker ?? "Newsroom"}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">{title}</h1>
        </div>
        <div className="enter-rise mt-6">{children}</div>
      </main>
    </div>
  );
}

function DeskNav({ night }: { night: boolean }) {
  const matchRoute = useMatchRoute();
  return (
    <nav className="nav-rail mx-auto max-w-6xl gap-1 px-4 pb-0 sm:px-6">
      {LINKS.map((l) => {
        const active = Boolean(
          matchRoute({ to: l.to, fuzzy: !("exact" in l && l.exact) }),
        );
        const base =
          "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-[color,border-color] duration-150 ease-out ";
        const idle = night
          ? "border-transparent text-paper-2 hover:text-paper"
          : "border-transparent text-ink-2 hover:text-ink";
        const on = "border-rust text-rust";
        return (
          <Link key={l.to} to={l.to} className={base + (active ? on : idle)}>
            {l.label}
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "solid" | "ghost" | "danger" | "invert";
  type?: "button" | "submit";
}) {
  const cls =
    tone === "solid"
      ? "bg-ink text-paper hover:bg-ink-2"
      : tone === "danger"
        ? "border border-danger text-danger hover:bg-paper-2"
        : tone === "invert"
          ? "bg-paper text-ink hover:bg-paper-2"
          : "border border-ink text-ink hover:bg-paper-2";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={
        "pressable inline-flex min-h-11 items-center justify-center px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 " +
        cls
      }
    >
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
    <label className="block space-y-1.5">
      <span className="text-[11px] tracking-[0.14em] text-muted uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "min-h-11 w-full border border-rule bg-paper px-3 text-sm text-ink outline-none transition-[border-color] duration-150 ease-out placeholder:text-muted/80 focus:border-ink";

export const areaClass =
  "w-full border border-rule bg-paper px-3 py-2 text-sm leading-6 text-ink outline-none transition-[border-color] duration-150 ease-out placeholder:text-muted/80 focus:border-ink";
