import { createFileRoute } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { DEFAULT_PAPER_IDENTITY, usePaper } from "@/lib/paper-context";

export const Route = createFileRoute("/how-we-report")({
  /*
    Its own title. Every standing page shared the site's title, so a reader with
    the paper open in several tabs could not tell them apart, and search results
    listed them all under one name.
  */
  head: ({ match }) => ({
    meta: [{ title: `How we report — ${(match.context.paper ?? DEFAULT_PAPER_IDENTITY).name}` }],
  }),
  component: How,
});

function How() {
  const PAPER = usePaper();
  return (
    <PaperShell compact>
      <h1 className="enter-fade font-display text-4xl font-semibold">
        How we report
      </h1>
      <div className="stagger-in mt-6 max-w-2xl space-y-4 text-lg leading-7 text-ink-2">
        <p>
          <strong className="text-ink">Watch.</strong> The desk keeps a list of
          {" "}{PAPER.city} civic sources — the city, its council, planning,
          the schools, the county, the local utility. That list is a starting
          point, not a fence. Newly discovered public records are fair game.
        </p>
        <p>
          <strong className="text-ink">Detect.</strong> Scans and background
          monitors fetch those pages, hash them against the last snapshot, and
          flag what changed, what disappeared, and what failed to appear when
          it usually does.
        </p>
        <p>
          <strong className="text-ink">Follow.</strong> Before a story is
          drafted, the desk asks what the announcing source leaves unexplained,
          then follows attachments, names, companies, contracts, parcels, prior
          meetings and historical versions. If a company or agency is named, we
          look for their own press release or newsroom page — not a rewrite of
          someone else's coverage. A useful story often lives one or two
          documents beyond the listing that led us there.
        </p>
        <p>
          <strong className="text-ink">Preserve.</strong> Significant captures
          are stored. If a record later vanishes, the captured version remains,
          and the article says so.
        </p>
        <p>
          <strong className="text-ink">Investigate.</strong> Dark Desk is the
          recursive lane: competing hypotheses, unresolved identities, and
          trails that were exhausted until new evidence reopened them. It does
          not print.
        </p>
        <p>
          <strong className="text-ink">Write, then gate.</strong> Drafts are
          reported stories, not recaps. Hold, kill, or publish is a person.
          Every material claim should be checkable against a document we show.
        </p>
        <p>
          <strong className="text-ink">Credit.</strong> When a story hangs on
          another newsroom’s reporting — the Longmont Leader, the Times-Call,
          the Daily Camera — we name them and link the exact story, not a
          homepage. Linking is how a reader gets to the original work. We do
          not copy their article, and we do not treat a section index as if we
          opened the piece.
        </p>
        <p>
          <strong className="text-ink">Corrections.</strong> Errors get a public
          note. We would rather look careful than look first.
        </p>
      </div>
    </PaperShell>
  );
}
