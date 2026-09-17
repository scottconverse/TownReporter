import { useEffect, useRef, type ReactNode } from "react";
import { usePaper } from "@/lib/paper-context";

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
  kicker,
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
  const paper = usePaper();
  const resolvedKicker = kicker ?? paper.kicker;
  /*
    Proof that React actually started, for the __root.tsx escape hatch.

    That fallback exists for the page where React never ran, and it can
    only see the DOM -- so it used to key on `data-awaiting-session`
    alone. But this screen is SERVER-rendered: the attribute is in the
    HTML before any script runs, and it is still there while a hydrated
    React sits waiting for a slow session. On a cold dev server hydration
    can take longer than the fallback's eight seconds, and a signed-in
    editor mid first-run setup was thrown to /login, back to /desk, back
    to /desk/setup with an empty form -- a loop that ate four CI browser
    walks in one day and would eat a real operator on a slow box. The
    fallback no longer navigates at all, but it still uses this stamp to
    keep from offering an escape hatch to someone who does not need one.

    An effect runs only on the client, only after this element is
    hydrated, so stamping it here is the one thing that distinguishes
    "React never started" from "React started and is waiting".
  */
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (awaitingSession) marker.current?.setAttribute("data-session-hydrated", "");
  }, [awaitingSession]);
  return (
    <div
      ref={marker}
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
          {resolvedKicker}
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
        {/*
          The way out of a page where React never started.

          Server-rendered and hidden, so it costs nothing and needs no
          script to exist. The inline fallback in __root.tsx unhides it
          after eight seconds if this screen has not been hydrated by
          then -- a visitor whose app is merely slow never sees it,
          because React hydrating this element re-hides it.
        */}
        {awaitingSession ? (
          <div className="mt-6" hidden data-stranded-signin>
            <a
              href="/login"
              className={
                "pressable inline-flex min-h-11 items-center justify-center border px-4 text-sm " +
                (night
                  ? "border-paper bg-ink text-paper"
                  : "border-ink bg-paper hover:bg-paper-2")
              }
            >
              Sign in
            </a>
          </div>
        ) : null}
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
  /*
    The night branch used to be `divide-ink-2 border-ink-2` -- `--color-ink-2`
    (#3a3129) is a fixed dark BROWN, so the dark desk's loading skeleton
    showed brown divider lines. `divide-rule` / `border-rule` / `bg-paper`
    are already redirected onto the desk's own theme vars inside `.desk-ltr`
    (see styles.css), so they render correctly in both themes with no
    branch needed at all.
  */
  void night;
  return (
    <ul className="mt-3 divide-y divide-rule border border-rule bg-paper" aria-busy="true" aria-label="Loading">
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
  night: _night = false,
}: {
  kind: "ok" | "err" | "warn";
  children: ReactNode;
  /** @deprecated no-op — Notice now follows `.desk-ltr`/`.desk-ltr.night` theme vars automatically. */
  night?: boolean;
}) {
  /*
    Notice used to take a manual `night` boolean and pick fixed Tailwind
    colors (border-danger/35, text-danger, ...). Call sites on the desk
    routes almost never passed it, so on the dark desk an error rendered in
    the *light-mode* dark-red -- unreadable against the dark panel (owner
    screenshot, story page, 2026-09-05).

    Fixed by styling purely with the `.notice-*` classes below, which read
    `--fg` / `--bg2` / `--line` / `--warn` / `--adeep` from the `.desk-ltr`
    scope (see styles.css) -- those flip automatically under
    `.desk-ltr.night`, so this component needs no theme prop at all. The
    prop stays, unused, so existing call sites keep compiling.

    Color alone never carries the kind: "err" gets a leading "!" glyph and
    "warn" a bold "Note:" label so the distinction survives for anyone who
    can't perceive the color difference.
  */
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
      className={"enter-rise notice mt-3 whitespace-pre-line border px-3 py-2.5 text-sm notice-" + kind}
      role={kind === "err" ? "alert" : "status"}
      aria-live={kind === "err" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {kind === "err" ? <strong aria-hidden="true">! </strong> : null}
      {kind === "warn" ? <strong>Note: </strong> : null}
      {children}
    </p>
  );
}

/**
 * A terminal error state for a query that has no data to fall back on.
 *
 * Audit finding UIUX-02: several desk routes destructured `{ data = [],
 * isPending }` from useQuery and never looked at `isError`. A failed fetch
 * then either spun forever (isPending never resolves on some paths) or
 * rendered as a silent empty list -- no message, no way to recover short of
 * reloading the whole page. This gives every such query the same terminal
 * branch: state what failed, in words, with a button that calls `refetch`.
 */
export function ScreenError({
  message,
  onRetry,
  retrying = false,
  night = false,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  night?: boolean;
}) {
  /*
    Used to pick fixed Tailwind colors for `night` (border-blush/40, bg-ink,
    text-blush, ...) -- `bg-ink` (`--color-ink`, #1c1410) is a fixed dark
    BROWN, not the desk's actual night background, so a full-screen error on
    the dark desk showed a brown panel instead of matching the black desk
    around it. `.screen-error*` (styles.css) reads the desk's own theme vars
    instead, so `.desk-ltr.night` flips these automatically; `night` stays
    accepted so call sites keep compiling.
  */
  void night;
  return (
    <div
      className="enter-fade-fast screen-error border px-5 py-8 text-center"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <p className="screen-error-message text-sm">{message}</p>
      <button
        type="button"
        className="screen-error-retry pressable mt-4 inline-flex min-h-11 items-center justify-center border px-4 text-sm font-medium"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? "Trying again…" : "Try again"}
      </button>
    </div>
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
