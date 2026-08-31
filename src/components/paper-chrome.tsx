import { Link, useMatchRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Search, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context";
import { inputClass } from "@/components/desk-chrome";
import { APP_VERSION } from "@/lib/version";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { deskClaimState } from "@/lib/news/claim";
import { createEditorCopy } from "@/lib/news/desk-copy";

export function Masthead({ compact = false }: { compact?: boolean }) {
  const paper = usePaper();
  const { formatDate } = usePaperDateFormatters();
  const today = formatDate(new Date());
  const Name = compact ? "p" : "h1";
  return (
    <header className="border-b border-ink">
      <a
        href="#paper"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
      >
        Skip to stories
      </a>
      <div className="flex items-center justify-between gap-3 border-b border-rule px-1 py-1 text-[11px] tracking-[0.14em] text-muted uppercase">
        <span>{paper.kicker}</span>
        <span className="hidden sm:inline">{today}</span>
        <AuthSlot />
      </div>
      <div className={compact ? "py-4 text-center" : "py-8 text-center sm:py-10"}>
        <Link
          to="/"
          className="inline-block transition-[color] duration-150 ease-out hover:text-rust"
        >
          {/*
            The front page had no `h1` at all — it began at `h2`, so the
            document had no name for a screen reader to announce or a search
            engine to weigh. On the front page the paper's own name is that
            name; everywhere else the story's headline is, and a second `h1`
            here would compete with it.
          */}
          <Name
            className={
              compact
                ? "font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl"
                : "font-display text-4xl font-semibold tracking-tight text-ink sm:text-6xl"
            }
          >
            {paper.name}
          </Name>
          <p className="mt-2 text-sm tracking-[0.18em] text-muted uppercase">
            {paper.location}
          </p>
        </Link>
        {!compact && (
          <>
            <p className="mx-auto mt-3 max-w-md font-display text-base italic text-ink-2">
              {paper.tagline}
            </p>
            <p className="mx-auto mt-1 text-[11px] tracking-[0.16em] text-muted uppercase">
              {paper.trust}
            </p>
          </>
        )}
      </div>
      <PaperNav />
    </header>
  );
}


/**
 * Archive search, folded into the top bar.
 *
 * It used to be a permanent form on the front page, taking a row of the paper's
 * most valuable space to serve the thing readers do least often. As a glass it
 * is one click away from every page rather than only the front one, and the
 * space goes back to the stories.
 *
 * Opening it moves focus into the field, and Escape closes it — a control that
 * can only be dismissed with a mouse is a control some readers cannot dismiss.
 */
function ArchiveSearch() {
  const navigate = useNavigate();
  const current = useRouterState({
    select: (st) => (st.location.search as { q?: string }).q ?? "",
  });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(current);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => setQ(current), [current]);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    void navigate({ to: "/", search: { q: term || undefined, topic: undefined } });
    if (!term) setOpen(false);
  };

  if (!open && !current) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search the archive"
        className="inline-flex min-h-11 shrink-0 items-center px-3 text-ink transition-[color] duration-150 ease-out hover:text-rust focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust"
      >
        <Search className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex min-h-11 shrink-0 items-center gap-1 px-2">
      <label className="relative block">
        <span className="sr-only">Search the archive</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          ref={field}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              if (current) void navigate({ to: "/", search: { q: undefined, topic: undefined } });
            }
          }}
          placeholder="Search the archive"
          enterKeyHint="search"
          className={inputClass + " w-44 pl-9 sm:w-56"}
        />
      </label>
      <button
        type="button"
        aria-label="Close search"
        onClick={() => {
          setOpen(false);
          if (current) void navigate({ to: "/", search: { q: undefined, topic: undefined } });
        }}
        className="inline-flex min-h-11 items-center px-2 text-muted hover:text-rust focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust"
      >
        <X className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    </form>
  );
}

function PaperNav() {
  const paper = usePaper();
  const matchRoute = useMatchRoute();
  /*
    Collapsed behind one "Sections" button on a phone (UX-001).

    At 375px the open nav, the search glass, the desk button, and the topic
    chips stacked to roughly 1300 pixels of chrome before the first headline —
    two full screens of scrolling on the surface most readers of a local paper
    arrive on. A disclosure keeps every section reachable in one tap (the
    earlier sideways-scroller ban still stands: nothing is cut off, it is
    folded), and from `sm` up the nav renders exactly as before.
  */
  const [open, setOpen] = useState(false);
  const currentTopic = useRouterState({
    select: (st) => (st.location.search as { topic?: string }).topic,
  });
  const items = [
    { to: "/", label: "The paper", exact: true },
    // A section, not just a filter chip: opinion is its own kind of writing and
    // a reader looking for it should not have to know it is a topic.
    { to: "/", label: "Opinion", search: { topic: "opinion" } },
    { to: "/about", label: "About" },
    { to: "/how-we-report", label: "How we report" },
    { to: "/corrections", label: "Corrections" },
  ] as const;

  return (
    /*
      Stacked on a phone, one row from small screens up.

      Side by side at every width, the nav had to share the bar with the search
      glass and the desk button, and at 375px that left it 184 pixels — seven
      links in a sideways scroller narrower than the button beside it. Giving
      the nav its own row costs nothing on a big screen and makes it usable on a
      small one.

      The switch is at 1024px, not 640. At 920 the seven links still wrapped to
      two rows, which stretched the black desk block to 102px — a tall slab
      beside a two-line nav. Stacking until there is real room is the honest
      breakpoint.
    */
    <div className="flex flex-col border-y-2 border-ink lg:flex-row lg:items-stretch">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-center gap-1 px-2 text-[12px] font-medium tracking-[0.12em] text-ink uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust sm:hidden"
      >
        Sections
        <ChevronDown
          className={"size-4 transition-transform duration-150 " + (open ? "rotate-180" : "")}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {/*
        From `sm` up: wraps, never scrolls sideways.

        This was a horizontal scroller with a fade, and at 665px it simply cut
        off after "Corrections" — city council votes and RSS were unreachable
        without a sideways drag most people never try on a link bar. Worse, the
        check that passed it counted the y-position of each link, and in a
        scroller every link shares one y whether it is on screen or not. The
        number said "one row" while two items were invisible.

        A newspaper nav is allowed to be two lines. It is not allowed to hide
        half its sections. Below `sm` the whole list folds behind the Sections
        button above — folded is not hidden: one tap shows every link, stacked.
      */}
      <nav
        className={
          (open ? "flex" : "hidden") +
          " w-full min-w-0 flex-col items-stretch px-1 py-1 text-[12px] font-medium tracking-[0.12em] uppercase sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-5 lg:w-auto lg:flex-1"
        }
      >
        {items.map((item) => {
          /*
            Opinion and The paper are the same route with different search.
            Matching on the path alone lit both at once, so the topic has to be
            part of the test.
          */
          const wantTopic = "search" in item ? item.search.topic : undefined;
          const onRoute = Boolean(
            matchRoute({ to: item.to, fuzzy: !("exact" in item && item.exact) }),
          );
          const active = onRoute && currentTopic === wantTopic;
          return (
            <Link
              key={item.label}
              to={item.to}
              search={"search" in item ? item.search : { topic: undefined, q: undefined }}
              onClick={() => setOpen(false)}
              className={
                "inline-flex min-h-11 shrink-0 items-center justify-center border-b-2 px-1 transition-[color,border-color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust sm:justify-start " +
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
          href={paper.councilVotesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center justify-center border-b-2 border-transparent px-1 transition-[color] duration-150 ease-out hover:text-rust focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust sm:justify-start"
        >
          City council votes
          <ExternalLink className="ml-1 size-3" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">(opens another site)</span>
        </a>
        <a
          href="/feed"
          className="inline-flex min-h-11 shrink-0 items-center justify-center border-b-2 border-transparent px-1 transition-[color] duration-150 ease-out hover:text-rust focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust sm:justify-start"
        >
          RSS
        </a>
      </nav>
      <div className="flex items-stretch justify-end border-t border-rule lg:border-t-0">
      <ArchiveSearch />
      <Link
        to="/desk"
        className="pressable inline-flex min-h-11 shrink-0 items-center bg-ink px-3 text-[12px] font-medium tracking-[0.12em] text-paper uppercase hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust"
      >
        Editor desk
      </Link>
      </div>
    </div>
  );
}

function AuthSlot() {
  const { user, isPending } = useCurrentUserState();
  const claim = useQuery({
    queryKey: ["desk-claim"],
    queryFn: () => deskClaimState(),
    staleTime: 15_000,
  });
  const unclaimed = claim.data && !claim.data.claimed;
  if (isPending || claim.isPending) {
    return (
      <div
        className="skeleton-rule h-11 w-16"
        aria-hidden
        title="Checking sign-in"
      />
    );
  }
  if (unclaimed) {
    return (
      /*
        Quiet on a phone, solid from `sm` up (UX-003). As a full-contrast ink
        block this was the single strongest element on a 375px first screen —
        ahead of the paper's own wordmark, on a surface whose audience is
        readers, not editors. Same link, same place; it just stops shouting
        where space is scarce.
      */
      <Link
        to="/login"
        className="pressable inline-flex min-h-11 items-center border border-ink px-3 text-[11px] tracking-[0.12em] text-ink uppercase hover:bg-ink hover:text-paper sm:border-0 sm:bg-ink sm:text-paper sm:hover:bg-ink-2"
      >
        {createEditorCopy().paper}
      </Link>
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
  const paper = usePaper();
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
        <Masthead compact={compact} />
        {/*
          A real `main` landmark, not a div.

          The masthead offers a "Skip to stories" link pointing here, which is
          the one control a keyboard or screen-reader user has for getting past
          the nav — and it was landing on an anonymous div, so nothing announced
          that they had arrived anywhere. The page also had no main region at
          all, which is what "skip to content" is defined against.
        */}
        <main id="paper" className="scroll-mt-4 py-8">
          {children}
        </main>
        <footer className="mt-8 border-t border-ink pt-4 pb-10 text-sm text-muted">
          <p>
            {paper.name} {APP_VERSION} · {paper.location}. {paper.tagline} Free to reprint with
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
