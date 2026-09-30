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
            Two signals are read on a visit, each for one purpose only.
          </p>
          <p>
            <strong>Where you are, roughly.</strong> This site is served through Cloudflare, which
            works out a city and a country from your IP address and passes those two facts to us
            with the request. We keep only a daily count for each place — never the address, and
            only ever a city or a country, never anything finer. Each reader is counted once a
            day, so reloading a page cannot make a town look busier than it was. A place is shown
            to the editor only on days when at least 25 readers were counted in it, so the row
            cannot be about one person; a day&rsquo;s readers below that, and small places on a
            finished day, are added together into &ldquo;other places&rdquo; rather than kept
            individually. We run no location database of our own: the city and country come from
            Cloudflare&rsquo;s network, worked out from your address there.
          </p>
          <p>
            <strong>Counting you once, without remembering you.</strong> We also read the address
            your request arrives from, and your browser&rsquo;s type — a handful of words such as
            &ldquo;phone&rdquo;, not the browser&rsquo;s own string. Both are used for one moment,
            to build a one-way code that changes every day and whose only job is to stop the same
            visit being counted twice. Neither the address nor the browser string is ever stored,
            logged or exported; the code cannot be turned back into an address, and today&rsquo;s
            code cannot be matched against yesterday&rsquo;s. That is why we cannot tell that you
            came back yesterday, and we do not try. No analytics service is involved.
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
