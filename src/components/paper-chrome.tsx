import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Bookmark, ExternalLink, Menu, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePaper } from "@/lib/paper-context-state";
import { APP_VERSION } from "@/lib/version";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { deskClaimState } from "@/lib/news/claim";
import { createEditorCopy } from "@/lib/news/desk-copy";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { usePublicSections } from "@/lib/use-sections";
import { utilityBillAnalyzerUrl } from "@/lib/paper-identity";
import {
  ReaderProvider,
  ReadingButton,
  ReaderDialog,
  CopyButton,
} from "./reader-controls";
import { useReader } from "./reader-context";

/**
 * The paper's three rows, in the order the handoff sets them
 * (`docs/design/handoff-2026-09-26/README.md`, "Front page"): the yellow
 * dateline bar, the masthead, the section nav.
 *
 * `geography` is a slot rather than a prop because the front page's pill row
 * (`GeoPills`) is the only thing that fills it, and it belongs to the front
 * page's search -- the article page's masthead carries no pills, per its own
 * prototype. A masthead that imported the pills would have to import the
 * front page's search shape with them.
 */
export function Masthead({ geography }: { geography?: ReactNode }) {
  const paper = usePaper();
  const { sections } = usePublicSections();
  const [open, setOpen] = useState(false);
  const r = useReader();
  const { formatDayStamp } = usePaperDateFormatters();
  const location = useRouterState({ select: (s) => s.location });
  const current = location.search as { topic?: string; q?: string; view?: string };
  useEffect(() => setOpen(false), [location.href]);
  return (
    <header>
      <a className="skip" href="#paper">
        Skip to stories
      </a>
      {/*
        The dateline bar. It carries the paper's own day and the four
        utilities that used to sit in the masthead; they moved up here because
        the masthead is now the wordmark and the geography, which is what a
        reader is looking at when they land.
      */}
      <div className="topbar">
        <div className="wrap topbarin">
          <span className="dateline" suppressHydrationWarning>
            Today in {paper.city} · {formatDayStamp(new Date())}
          </span>
          <div className="topactions">
            <Link to="/" search={{ view: "archive" }} className="toplink">
              <Search aria-hidden />
              <span>Search</span>
            </Link>
            <Link to="/" search={{ view: "saved" }} className="toplink">
              <Bookmark aria-hidden />
              <span>Saved{r.saved.length ? ` · ${r.saved.length}` : ""}</span>
            </Link>
            <ReadingButton label />
            {/*
              The desk entry deliberately performs a document navigation. An
              in-app transition can change the URL to /desk while the public
              home remains mounted, which is the reported regression this path
              must prevent. A fresh document load lets the /desk route gate
              decide from the server-rendered route.
            */}
            <a href="/desk" className="toplink">
              Editor’s desk
            </a>
          </div>
        </div>
      </div>
      <div className="wrap">
        <div className="mast">
          <div className="identity">
            <Link to="/" search={{}} className="brand" aria-label={`${paper.name} home`}>
              {paper.name}
            </Link>
            {/*
              The town tag. It replaces the old three-line "Independent. Local.
              Accountable." standfirst, which no longer fits the masthead's
              one-line rule and is printed in the footer either way.
            */}
            <span className="locality">{paper.city}</span>
          </div>
          {geography}
        </div>
        <div className="navrow">
          <button
            className="mobilemenu"
            type="button"
            aria-expanded={open}
            aria-controls="reader-sections"
            onClick={() => setOpen(!open)}
          >
            Explore the publication
            <Menu aria-hidden />
          </button>
          <nav
            className={`sections ${open ? "open" : ""}`}
            id="reader-sections"
            aria-label="News sections"
          >
            <Link
              to="/"
              search={{}}
              className={
                location.pathname === "/" && !current.topic && !current.q && !current.view
                  ? "active"
                  : ""
              }
            >
              Front page
            </Link>
            {sections
              .filter((s) => s.visible)
              .map((s) => (
                <Link
                  key={s.key}
                  to="/"
                  search={{ topic: s.key }}
                  className={current.topic === s.key ? "active" : ""}
                >
                  {s.name}
                </Link>
              ))}
          </nav>
          <div className="reader-nav-actions">
            {/*
              The nav row's one action. The desk entry used to sit beside it
              and now sits in the dateline bar, which is where the handoff puts
              it; printing it twice on one screen is noise, not reach.
            */}
            <Link to="/about" className="textlink about-newsroom">
              About the newsroom <ArrowRight aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
function FollowFeed() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  return (
    <>
      <button
        type="button"
        className="footer-button"
        onClick={() => {
          setUrl(new URL("/feed", window.location.origin).href);
          setOpen(true);
        }}
      >
        Follow with RSS
      </button>
      {open && (
        <ReaderDialog title="New stories, in your reader." close={() => setOpen(false)}>
          <p>Follow this publication using any RSS reader.</p>
          <input className="field" aria-label="RSS feed address" readOnly value={url} />
          <div className="sourceactions">
            <CopyButton text={url}>Copy feed address</CopyButton>
            <a href="/feed" className="btn" target="_blank" rel="noreferrer">
              Open feed <ExternalLink aria-hidden />
            </a>
          </div>
        </ReaderDialog>
      )}
    </>
  );
}
export function ReaderResources() {
  const paper = usePaper();
  const analyzer = utilityBillAnalyzerUrl(paper);
  if (!paper.councilVotesUrl && !analyzer) return null;
  return (
    <section className="sidebarcard warm">
      <h2>Useful around town</h2>
      <p>A few good places to go deeper.</p>
      {paper.councilVotesUrl && (
        <a className="toolitem" href={paper.councilVotesUrl} target="_blank" rel="noreferrer">
          City Council Votes <ExternalLink aria-hidden />
        </a>
      )}
      {analyzer && (
        <a className="toolitem" href={analyzer} target="_blank" rel="noreferrer">
          Utility Bill Analyzer <ExternalLink aria-hidden />
        </a>
      )}
    </section>
  );
}
export function PaperShell({
  children,
  compact = false,
  geography,
}: {
  children: ReactNode;
  compact?: boolean;
  /** The masthead's geography slot; only the front page fills it. */
  geography?: ReactNode;
}) {
  const paper = usePaper();
  return (
    <ReaderProvider>
      <Masthead geography={geography} />
      <main
        id="paper"
        tabIndex={-1}
        className={`wrap reader-main ${compact ? "reader-compact" : ""}`}
      >
        {children}
      </main>
      <footer>
        <div className="wrap">
          <div className="footergrid">
            <div>
              <Link className="brand" to="/" search={{}}>
                {paper.name}
              </Link>
              <p>
                A clearer view of {paper.city}.<br />
                {paper.tagline}
              </p>
            </div>
            <div className="footerlinks">
              <div>
                <b>THE PUBLICATION</b>
                <Link to="/" search={{ view: "archive" }}>
                  Search the archive
                </Link>
                <Link to="/" search={{ topic: "opinion" }}>
                  Opinion
                </Link>
                <Link to="/" search={{ view: "saved" }}>
                  Saved stories
                </Link>
                <FollowFeed />
              </div>
              <div>
                <b>THE NEWSROOM</b>
                <Link to="/about">About us</Link>
                <Link to="/how-we-report">How we report</Link>
                <Link to="/corrections">Corrections</Link>
                {/*
                  Boundary entry: leave the reader app with a document
                  navigation. An in-app route transition can leave a public
                  surface mounted under /desk; a fresh load lets the desk gate
                  decide from the server-rendered route.
                */}
                <a href="/desk">
                  Editor’s desk <ArrowRight aria-hidden />
                </a>
                <AuthSlot />
              </div>
            </div>
          </div>
          <div className="footerbottom">
            <span>
              Free to read. Free to reprint with credit and a link. Verify details against the
              official record.
            </span>
            <span>
              {paper.name} {APP_VERSION} · {paper.location}
            </span>
          </div>
        </div>
      </footer>
    </ReaderProvider>
  );
}
export function TopicChip({ topic, active }: { topic: string; active?: boolean }) {
  const { sections } = usePublicSections();
  return (
    <Link to="/" search={{ topic }} className={`btn ${active ? "primary" : ""}`}>
      {sections.find((s) => s.key === topic)?.name ?? topic}
    </Link>
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
    return <div className="skeleton-rule h-11 w-16" aria-hidden title="Checking sign-in" />;
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
      <Link to="/login" className="btn primary">
        {createEditorCopy().paper}
      </Link>
    );
  }
  if (user) {
    return (
      <span className="flex items-center gap-2 normal-case tracking-normal">
        {/*
          The signed-in masthead is still a reader boundary. Use a document
          navigation so /desk is decided by a fresh server-rendered route
          rather than an in-app transition that can retain public content.
        */}
        <a href="/desk" className="btn small">
          Desk
        </a>
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
