import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Bookmark, ExternalLink, Menu, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePaper } from "@/lib/paper-context";
import { APP_VERSION } from "@/lib/version";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { deskClaimState } from "@/lib/news/claim";
import { createEditorCopy } from "@/lib/news/desk-copy";
import { usePublicSections } from "@/lib/use-sections";
import { utilityBillAnalyzerUrl } from "@/lib/paper-identity";
import {
  ReaderProvider,
  ReadingButton,
  useReader,
  ReaderDialog,
  CopyButton,
} from "./reader-controls";

export function Masthead() {
  const paper = usePaper();
  const { sections } = usePublicSections();
  const [open, setOpen] = useState(false);
  const r = useReader();
  const location = useRouterState({ select: (s) => s.location });
  const current = location.search as { topic?: string; q?: string; view?: string };
  useEffect(() => setOpen(false), [location.href]);
  return (
    <header>
      <a className="skip" href="#paper">
        Skip to stories
      </a>
      <div className="wrap">
        <div className="mast">
          <div className="identity">
            <Link to="/" search={{}} className="brand" aria-label={`${paper.name} home`}>
              {paper.name}
            </Link>
            <div className="locality">
              <strong>{paper.location}</strong>Independent. Local. Accountable.
            </div>
          </div>
          <div className="utilities">
            <Link
              to="/"
              search={{ view: "archive" }}
              className="btn subtle"
              aria-label="Search stories"
            >
              <Search aria-hidden />
              <span className="searchlabel">Search stories</span>
            </Link>
            <Link
              to="/"
              search={{ view: "saved" }}
              className="btn subtle"
              aria-label="Saved stories"
            >
              <Bookmark aria-hidden />
              <span className="savedlabel">
                Saved{r.saved.length ? ` · ${r.saved.length}` : ""}
              </span>
            </Link>
            <ReadingButton />
          </div>
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
            <Link to="/about" className="textlink about-newsroom">
              About the newsroom <ArrowRight aria-hidden />
            </Link>
            {/*
              The public-home desk entry deliberately performs a document
              navigation. An in-app transition can change the URL to /desk
              while the public home remains mounted, which is the reported
              regression this path must prevent. A fresh document load lets
              the /desk route gate decide from the server-rendered route.
            */}
            <a href="/desk" className="btn desk-entry">
              Editor’s desk <ArrowRight aria-hidden />
            </a>
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
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  const paper = usePaper();
  return (
    <ReaderProvider>
      <Masthead />
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
                <Link to="/desk">
                  Editor’s desk <ArrowRight aria-hidden />
                </Link>
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
        <Link to="/desk" className="btn small">
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
