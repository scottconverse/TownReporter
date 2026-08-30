import type { ReactNode } from "react";
import { PAPER } from "@/lib/paper";

function Ornament({
  busy = false,
  night = false,
}: {
  busy?: boolean;
  night?: boolean;
}) {
  return (
    <div
      className={
        "ornament " +
        (busy ? "ornament-busy " : "") +
        (night ? "ornament-night" : "")
      }
      aria-hidden
    >
      <span />
      <i />
      <span />
    </div>
  );
}

export function ScreenPending({
  title,
  kicker = PAPER.kicker,
  hint = "Setting type…",
  night = false,
  action,
  awaitingSession = false,
}: {
  title: string;
  kicker?: string;
  hint?: string;
  night?: boolean;
  action?: ReactNode;
  /**
   * Marks the one pending screen shown to a visitor whose session is still
   * unknown. The no-JavaScript fallback in __root.tsx keys on this attribute
   * rather than on the heading text -- see the comment there for why.
   */
  awaitingSession?: boolean;
}) {
  return (
    <div
      className={
        night
          ? "grid min-h-dvh place-items-center bg-ink px-6 text-paper"
          : "grid min-h-dvh place-items-center bg-paper px-6 text-ink"
      }
      role="status"
      {...(awaitingSession ? { "data-awaiting-session": "" } : {})}
      aria-live="polite"
      aria-busy="true"
    >
      <div className="enter-fade max-w-sm text-center">
        <p className="text-[11px] tracking-[0.16em] text-rust uppercase">
          {kicker}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">{title}</h1>
        <div className="mt-6">
          <Ornament busy night={night} />
        </div>
        {hint ? (
          <p
            className={
              "shimmer-text mt-5 text-sm " +
              (night ? "text-paper-2" : "text-muted")
            }
          >
            {hint}
          </p>
        ) : null}
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  kicker,
  title,
  body,
  action,
  children,
  night = false,
}: {
  kicker?: string;
  title: string;
  body: string;
  action?: ReactNode;
  children?: ReactNode;
  night?: boolean;
}) {
  return (
    <div
      className={
        night
          ? "enter-fade-fast border border-paper/15 bg-ink px-5 py-12 text-center"
          : "enter-fade-fast border border-rule bg-paper-2 px-5 py-12 text-center"
      }
      role="status"
    >
      <Ornament night={night} />
      {kicker ? (
        <p className="mt-5 text-[11px] tracking-[0.16em] text-rust uppercase">
          {kicker}
        </p>
      ) : (
        <div className="mt-5" />
      )}
      <h2 className="mt-2 font-display text-2xl font-semibold text-balance">
        {title}
      </h2>
      <p
        className={
          "mx-auto mt-2 max-w-md text-pretty " +
          (night ? "text-paper-2" : "text-ink-2")
        }
      >
        {body}
      </p>
      {action ? (
        <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>
      ) : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

export function Rule({
  className = "",
  night = false,
}: {
  className?: string;
  night?: boolean;
}) {
  return (
    <div
      className={
        "skeleton-rule " +
        (night ? "skeleton-rule-night " : "") +
        className
      }
      aria-hidden
    />
  );
}

export function EditionSkeleton() {
  return (
    <div
      className="skeleton-stack space-y-8"
      aria-busy="true"
      aria-label="Loading the edition"
    >
      <div className="border-b border-ink pb-10">
        <Rule className="w-32" />
        <Rule className="mt-4 h-8 w-5/6 sm:h-10" />
        <Rule className="mt-3 h-8 w-3/5" />
        <Rule className="mt-6 h-4 w-full max-w-2xl" />
        <Rule className="mt-2 h-4 w-full max-w-xl" />
        <Rule className="mt-2 h-4 w-2/3 max-w-lg" />
        <Rule className="mt-5 h-4 w-36" />
      </div>
      <div className="grid gap-8 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-t border-rule pt-4">
            <Rule className="w-24" />
            <Rule className="mt-3 h-6 w-4/5" />
            <Rule className="mt-3 h-4 w-full" />
            <Rule className="mt-2 h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StorySkeleton() {
  return (
    <div
      className="skeleton-stack max-w-3xl space-y-4"
      aria-busy="true"
      aria-label="Loading story"
    >
      <Rule className="w-40" />
      <Rule className="mt-3 h-10 w-5/6" />
      <Rule className="h-10 w-3/5" />
      <Rule className="mt-4 h-5 w-2/3" />
      <div className="mt-8 space-y-3">
        <Rule className="h-4 w-full" />
        <Rule className="h-4 w-full" />
        <Rule className="h-4 w-5/6" />
        <Rule className="h-4 w-full" />
        <Rule className="h-4 w-3/4" />
        <Rule className="h-4 w-full" />
        <Rule className="h-4 w-4/5" />
      </div>
    </div>
  );
}

export function ListSkeleton({
  rows = 4,
  night = false,
}: {
  rows?: number;
  night?: boolean;
}) {
  return (
    <ul
      className={
        night
          ? "mt-3 divide-y divide-ink-2 border border-ink-2"
          : "mt-3 divide-y divide-rule border border-rule bg-paper"
      }
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="skeleton-stack space-y-2 px-4 py-3">
          <Rule night={night} className="h-4 w-2/3" />
          <Rule night={night} className="h-3 w-full" />
          <Rule night={night} className="h-3 w-1/2" />
        </li>
      ))}
    </ul>
  );
}

export function StatSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton-stack border border-rule bg-paper p-4">
          <Rule className="h-3 w-24" />
          <Rule className="mt-3 h-8 w-12" />
        </div>
      ))}
    </div>
  );
}

export function WorkbenchSkeleton() {
  return (
    <div
      className="skeleton-stack max-w-3xl space-y-4"
      aria-busy="true"
      aria-label="Loading lead"
    >
      <Rule className="h-4 w-full max-w-xl" />
      <Rule className="h-4 w-2/3" />
      <div className="mt-6 flex gap-3">
        <Rule className="h-11 w-36" />
        <Rule className="h-11 w-28" />
      </div>
      <Rule className="mt-8 h-3 w-24" />
      <Rule className="h-11 w-full" />
      <Rule className="h-3 w-16" />
      <Rule className="h-11 w-full" />
      <Rule className="h-3 w-20" />
      <Rule className="h-40 w-full" />
    </div>
  );
}

export function BusyLine({
  label,
  night = false,
}: {
  label: string;
  night?: boolean;
}) {
  return (
    <div className="flex items-start gap-3" role="status" aria-live="polite">
      <span className="busy-rule mt-2.5 w-10 shrink-0" aria-hidden />
      <p
        className={
          "shimmer-text text-sm " + (night ? "text-paper-2" : "text-muted")
        }
      >
        {label}
      </p>
    </div>
  );
}

export function FetchingRule({ active }: { active: boolean }) {
  return (
    <>
      <div className="fetching-track" aria-hidden>
        {active ? <div className="fetching-bar" /> : null}
      </div>
      {active ? (
        <p className="sr-only" role="status">
          Updating the edition
        </p>
      ) : null}
    </>
  );
}

export function Notice({
  kind,
  children,
  night = false,
}: {
  kind: "ok" | "err" | "warn";
  children: ReactNode;
  night?: boolean;
}) {
  const color =
    kind === "err"
      ? night
        ? "border-blush/40 text-blush"
        : "border-danger/35 bg-paper-2 text-danger"
      : kind === "warn"
        ? night
          ? "border-paper/25 text-paper"
          : "border-rust/35 bg-paper-2 text-rust"
        : night
          ? "border-paper/20 text-paper"
          : "border-ink/20 bg-paper-2 text-ink";
  /*
    A live region has to exist BEFORE its content changes.

    Notice already carried role="status" / role="alert", which implies a live
    region — but the element is mounted at the same moment its text appears, and
    a region that arrives with its content is frequently not announced at all.
    An audit found async success and error feedback inconsistently spoken
    (UIUX-03).

    aria-live is explicit here, and `aria-atomic` makes the whole notice read as
    one message rather than a fragment. The always-mounted companion region
    lives in DeskShell, which covers notices rendered by mutations that unmount
    and remount.
  */
  return (
    <p
      className={"enter-fade-fast mt-3 border px-3 py-2.5 text-sm " + color}
      role={kind === "err" ? "alert" : "status"}
      aria-live={kind === "err" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {children}
    </p>
  );
}

export function GrokStatusNotice({
  available,
  message,
  night = false,
}: {
  available?: boolean;
  message?: string;
  night?: boolean;
}) {
  if (available !== false) return null;
  return (
    <Notice kind="warn" night={night}>
      {message || "Grok isn't connected in this preview."}
    </Notice>
  );
}
