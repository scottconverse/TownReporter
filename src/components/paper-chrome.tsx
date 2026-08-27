import { Link, useMatchRoute } from "@tanstack/react-router";
import { PAPER, formatDate } from "@/lib/paper";
import { APP_VERSION } from "@/lib/version";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export function Masthead({ compact = false }: { compact?: boolean }) {
  const today = formatDate(new Date());
  return (
    <header className="border-b border-ink">
      <a
        href="#paper"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
      >
        Skip to stories
      </a>
      <div className="flex items-center justify-between gap-3 border-b border-rule px-1 py-1 text-[11px] tracking-[0.14em] text-muted uppercase">
        <span>{PAPER.kicker}</span>
        <span className="hidden sm:inline">{today}</span>
        <AuthSlot />
      </div>
      <div className={compact ? "py-4 text-center" : "py-8 text-center sm:py-10"}>
        <Link
          to="/"
          className="inline-block transition-[color] duration-150 ease-out hover:text-rust"
        >
          <p
            className={
              compact
                ? "font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl"
                : "font-display text-4xl font-semibold tracking-tight text-ink sm:text-6xl"
            }
          >
            {PAPER.name}
          </p>
          <p className="mt-2 text-sm tracking-[0.18em] text-muted uppercase">
            {PAPER.location}
          </p>
        </Link>
        {!compact && (
          <>
            <p className="mx-auto mt-3 max-w-md font-display text-base italic text-ink-2">
              {PAPER.tagline}
            </p>
            <p className="mx-auto mt-1 text-[11px] tracking-[0.16em] text-muted uppercase">
              {PAPER.trust}
            </p>
          </>
        )}
      </div>
      <PaperNav />
    </header>
  );
}

function PaperNav() {
  const matchRoute = useMatchRoute();
  const items = [
    { to: "/", label: "The paper", exact: true },
    { to: "/about", label: "About" },
    { to: "/how-we-report", label: "How we report" },
    { to: "/corrections", label: "Corrections" },
  ] as const;

  return (
    <div className="flex items-stretch border-y-2 border-ink">
      <nav className="nav-rail min-w-0 flex-1 items-center gap-x-5 px-1 py-0.5 text-[12px] font-medium tracking-[0.12em] uppercase sm:flex-wrap sm:justify-center">
        {items.map((item) => {
          const active = Boolean(
            matchRoute({ to: item.to, fuzzy: !("exact" in item && item.exact) }),
          );
          return (
            <Link
              key={item.to}
              to={item.to}
              className={
                "inline-flex min-h-11 shrink-0 items-center border-b-2 px-1 transition-[color,border-color] duration-150 ease-out " +
                (active
                  ? "border-rust text-rust"
                  : "border-transparent text-ink hover:text-rust")
              }
            >
              {item.label}
            </Link>
          );
        })}
        <a
          href="/feed"
          className="inline-flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-1 transition-[color] duration-150 ease-out hover:text-rust"
        >
          RSS
        </a>
      </nav>
      <Link
        to="/desk"
        className="pressable inline-flex min-h-11 shrink-0 items-center bg-ink px-3 text-[12px] font-medium tracking-[0.12em] text-paper uppercase hover:bg-ink-2"
      >
        Editor desk
      </Link>
    </div>
  );
}

function AuthSlot() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <div
        className="skeleton-rule h-11 w-16"
        aria-hidden
        title="Checking sign-in"
      />
    );
  }
  if (user) {
    return (
      <span className="flex items-center gap-2 normal-case tracking-normal">
        <Link
          to="/desk"
          className="pressable bg-ink px-3 py-1 text-[11px] tracking-[0.12em] text-paper uppercase hover:bg-ink-2"
        >
          Desk
        </Link>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </span>
    );
  }
  return (
    <SignedOut>
      <Link
        to="/login"
        className="inline-flex min-h-11 items-center transition-[color] duration-150 ease-out hover:text-rust"
      >
        Sign in
      </Link>
    </SignedOut>
  );
}

export function PaperShell({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
        <Masthead compact={compact} />
        <div id="paper" className="scroll-mt-4 py-8">
          {children}
        </div>
        <footer className="mt-8 border-t border-ink pt-4 pb-10 text-sm text-muted">
          <p>
            {PAPER.name} {APP_VERSION} · {PAPER.location}. {PAPER.tagline} Free to reprint with
            credit and a link back. Verify details against the official record.
          </p>
        </footer>
      </div>
    </div>
  );
}

export function TopicChip({
  topic,
  active,
}: {
  topic: string;
  active?: boolean;
}) {
  return (
    <Link
      to="/"
      search={{ topic }}
      className={
        "pressable inline-flex min-h-11 shrink-0 items-center border px-3 text-[11px] tracking-[0.14em] uppercase transition-[background-color,color,border-color] duration-150 ease-out " +
        (active
          ? "border-ink bg-ink text-paper"
          : "border-rule text-ink-2 hover:border-ink hover:text-ink")
      }
    >
      {topic}
    </Link>
  );
}
