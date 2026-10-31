import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePaper } from "@/lib/paper-context-state";
import { APP_VERSION } from "@/lib/version";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { deskClaimState } from "@/lib/news/claim";
import { createEditorCopy } from "@/lib/news/desk-copy";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { usePublicSections } from "@/lib/use-sections";
import { isMiscTopic } from "@/lib/news/section-types";
import { utilityBillAnalyzerUrl } from "@/lib/paper-identity";
import { clearerViewSentence } from "@/lib/paper-phrases";
import {
  DarkModeButton,
  ReaderProvider,
  ReadingButton,
  ReaderDialog,
  CopyButton,
} from "./reader-controls";
import { NAV_ID, SectionNav } from "./section-nav";
import { useReader } from "./reader-context";

/**
 * The Bulletin masthead: two rows shared by every reader page.
 *
 * Row one carries the wordmark, town and date, then search, saved stories,
 * appearance, text size and the editor's desk. Row two carries the front
 * page's geography, the fitted section links and (front page only) About the
 * newsroom. Below `NAV_FIT_MIN_WIDTH` the section links become the in-flow
 * "Explore the publication" menu.
 *
 * `geography` remains a slot because the front page's pill row (`GeoPills`) is
 * the only thing that fills it. `compact` remains accepted for route
 * compatibility; the Bulletin uses the same shell on every public page.
 */
export function Masthead({
  geography,
}: {
  geography?: ReactNode;
  /** Kept for route compatibility; the Bulletin uses the same shell everywhere. */
  compact?: boolean;
}) {
  const paper = usePaper();
  const { sections } = usePublicSections();
  const [open, setOpen] = useState(false);
  const r = useReader();
  const { formatDayStamp } = usePaperDateFormatters();
  const location = useRouterState({ select: (s) => s.location });
  const current = location.search as { topic?: string; q?: string; view?: string };
  const frontPage = location.pathname === "/" && !current.topic && !current.q && !current.view;
  useEffect(() => setOpen(false), [location.href]);
  const sectionNav = (
    <SectionNav
      sections={sections.filter((s) => s.visible)}
      activeTopic={current.topic}
      frontPageActive={frontPage}
      includeAbout={frontPage}
      menuOpen={open}
    />
  );
  return (
    <header className="masthead">
      <a className="skip" href="#paper">
        Skip to stories
      </a>
      <div className="wrap mast-top">
        <div className="identity">
          <Link to="/" search={{}} className="brand" aria-label={`${paper.name} home`}>
            {paper.name}
          </Link>
          {paper.city.trim() ? <span className="town">{paper.city}</span> : null}
          <span className="datestamp" suppressHydrationWarning>
            {formatDayStamp(new Date())}
          </span>
        </div>
        <div className="mast-actions">
          <form className="searchstories" method="get" action="/" role="search">
            <input type="hidden" name="view" value="archive" />
            <input name="q" type="search" placeholder="Search stories" aria-label="Search stories" />
          </form>
          <Link to="/" search={{ view: "saved" }} className="utilitylink">
            Saved{r.saved.length ? ` · ${r.saved.length}` : ""}
          </Link>
          <DarkModeButton label />
          <ReadingButton short />
          <a href="/desk" className="utilitylink">
            Editor’s desk
          </a>
        </div>
      </div>
      <div className="wrap mast-nav">
        {frontPage && geography ? <div className="mast-geo">{geography}</div> : null}
        <button
          className="mobilemenu"
          type="button"
          aria-expanded={open}
          aria-controls={NAV_ID}
          onClick={() => setOpen(!open)}
        >
          Explore the publication <span aria-hidden>☰</span>
        </button>
        {sectionNav}
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
            <CopyButton text={url} primary>Copy feed address</CopyButton>
            <a href="/feed" className="btn" target="_blank" rel="noreferrer">
              Open feed <ExternalLink aria-hidden />
            </a>
          </div>
        </ReaderDialog>
      )}
    </>
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
  /*
    The paper's own tool links. They lived in a "Useful around town" card at
    the foot of the front page; unit BX removed the card and moved the two
    links here, into the footer's publication column. Neither is dropped: a
    configured council-votes address and the analyzer (which
    `utilityBillAnalyzerUrl` only offers to the town it belongs to) print
    exactly as before, one column over.
  */
  const townTools = utilityBillAnalyzerUrl(paper);
  return (
    <ReaderProvider>
      <Masthead geography={geography} compact={compact} />
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
                {clearerViewSentence(paper.city)}
                <br />
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
                {paper.councilVotesUrl && (
                  <a href={paper.councilVotesUrl} target="_blank" rel="noreferrer">
                    City Council Votes <ExternalLink aria-hidden />
                  </a>
                )}
                {townTools && (
                  <a href={townTools} target="_blank" rel="noreferrer">
                    Utility Bill Analyzer <ExternalLink aria-hidden />
                  </a>
                )}
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
/**
 * A section chip. The reader side never names the "misc" bucket (unit BX), so
 * a misc chip prints nothing rather than a label for a filing instruction.
 * (No caller today; kept correct so the next one cannot reintroduce it.)
 */
export function TopicChip({ topic, active }: { topic: string; active?: boolean }) {
  const { sections } = usePublicSections();
  if (isMiscTopic(topic)) return null;
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
