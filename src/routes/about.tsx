import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { usePaper } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";

export const Route = createFileRoute("/about")({
  /*
    Its own title. Every standing page shared the site's title, so a reader with
    the paper open in several tabs could not tell them apart, and search results
    listed them all under one name.
  */
  head: ({ match }) => ({
    meta: [{ title: `About this paper — ${(match.context.paper ?? DEFAULT_PAPER_IDENTITY).name}` }],
  }),
  component: About,
});

function About() {
  const PAPER = usePaper();
  const EDITOR_EMAIL = PAPER.editorEmail;
  return (
    <PaperShell compact>
      <div className="infopage">
        <h1 className="enter-fade font-display text-4xl font-semibold">About this paper</h1>
        <p className="mt-3 text-[11px] tracking-[0.16em] text-rust uppercase">
          Independent civic reporting for {PAPER.city}
        </p>
        <div className="stagger-in mt-6 max-w-2xl space-y-4 text-lg leading-7 text-ink-2">
          <p>
            {PAPER.name} is a local non-profit newsroom and investigative record system for{" "}
            {PAPER.location}. The public record is only the beginning.
          </p>
          <p>
            We follow {PAPER.city}’s meetings, money, contracts and public records — then keep
            digging when something changes, disappears or doesn’t add up. A human editor decides
            what is published for reported stories. The owner may separately activate automatic
            roundups of approved library, recreation, community-event, registration,
            waste-collection and public-meeting notices; arbitrary prose, investigations, disputes
            and ambiguous claims stay outside that path. {PAPER.trust}
          </p>
          <p>
            The source list is where reporting starts, not where it stops. We watch known civic
            pages, notice new documents and anomalies, follow names and contracts off that list,
            compare records over time, and keep copies of significant material. Dark Desk is the
            recursive investigative lane: competing hypotheses, historical versions, and trails the
            announcing source did not include.
          </p>
          <p>
            We are not the city government, and we are not a replacement for the old local
            newspaper. We cover the packets most people never sit through, and we show the exact
            documents we used.
          </p>
          {/*
            The reader-facing half of the Stats privacy rule (owner decision,
            2026-09-30). It says exactly what is read and what is kept, in the
            same words the desk's own Stats page uses, so a reader can check the
            two against each other. Written here because the redesign asked for
            it (docs/design/handoff-2026-09-26/KICKOFF.md:154) and it had never
            been done: /about carried no privacy statement at all.
          */}
          <p>
            <strong>What we count, and what we keep.</strong> We count page loads, reading time,
            and which of our own pages and buttons readers use — in aggregate, never per person.
            No cookies, no accounts, no fingerprinting, and no identifier that outlives the day.
            Two things are read off a request, each for one purpose only. One is the city and
            country your network reports, so we can say roughly which places our readers are in;
            it is counted by the day, and a place is only ever shown once enough visits have
            landed there that the row cannot be one reader. The other is the address your request
            arrives from and your browser&rsquo;s user-agent, reduced to a few words and used only
            to avoid counting you twice in the same day. Neither is stored, logged or exported,
            and the value that tells two readers apart exists only in the server&rsquo;s memory and
            is thrown away at midnight. So we cannot tell that you came back yesterday, and we do
            not try. No location database is consulted, and no analytics service is involved.
          </p>
          {EDITOR_EMAIL ? (
            <p>
              <strong>Corrections and tips.</strong> Write the editor at{" "}
              <a className="text-rust underline" href={`mailto:${EDITOR_EMAIL}`}>
                {EDITOR_EMAIL}
              </a>
              . Every correction we make is published at{" "}
              <Link className="text-rust underline" to="/corrections">
                Corrections
              </Link>
              , and on the story itself.
            </p>
          ) : null}
        </div>
      </div>
    </PaperShell>
  );
}
