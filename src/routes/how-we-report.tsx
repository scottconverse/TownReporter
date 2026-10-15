import { createFileRoute } from "@tanstack/react-router";
import { ReadBeacon } from "@/components/read-beacon";
import { PaperShell } from "@/components/paper-chrome";
import { usePaper } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";
import { civicSourcesPhrase } from "@/lib/paper-phrases";

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
      {/* Reaching this page is the trust signal "How we reported this" reached. */}
      <ReadBeacon />
      <div className="infopage">
        <h1 className="enter-fade font-display text-4xl font-semibold">How we report</h1>
        <div className="stagger-in mt-6 max-w-2xl space-y-4 text-lg leading-7 text-ink-2">
          <p>
            <strong className="text-ink">Watch.</strong> The desk keeps a list of{" "}
            {civicSourcesPhrase(PAPER.city)} — the city, its council, planning, the schools, the
            county, the local utility. That list is a starting point. We also report from public
            records we find outside it.
          </p>
          <p>
            <strong className="text-ink">Detect.</strong> Scans fetch those pages and compare them
            with the last copy. They flag what changed, what disappeared, and what did not appear
            when it usually does.
          </p>
          <p>
            <strong className="text-ink">Follow.</strong> Before a story is drafted, the desk asks
            what the first source leaves unexplained. It follows attachments, names, companies,
            contracts, parcels, past meetings and older versions. When a company or agency is named,
            we look for its own announcement first.
          </p>
          <p>
            <strong className="text-ink">Preserve.</strong> We store copies of important records. If
            a record later disappears, our copy remains, and the story says so.
          </p>
          <p>
            <strong className="text-ink">Write, then check.</strong> A person decides whether to
            hold, kill or publish every story. We aim to tie every key fact to a document we show.
          </p>
          <p>
            <strong className="text-ink">Credit.</strong> When another newsroom’s reporting leads us
            to a fact or a record, we name them and link the exact story. We confirm key facts
            against the record before we repeat them.
            {PAPER.editorEmail ? (
              <>
                {" "}
                To ask us to remove an excerpt, write to{" "}
                <a className="text-rust underline" href={`mailto:${PAPER.editorEmail}`}>
                  {PAPER.editorEmail}
                </a>
                .
              </>
            ) : null}
          </p>
          <p>
            <strong className="text-ink">Corrections.</strong> Errors get a public note on the story
            and on our{" "}
            <a className="text-rust underline" href="/corrections">
              Corrections page
            </a>
            , with the date and what changed. To report an error, use the form on the Corrections
            page. We would rather look careful than look first.
          </p>
        </div>
      </div>
    </PaperShell>
  );
}
