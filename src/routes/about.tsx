import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { usePaper } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";
import { civicReportingLine } from "@/lib/paper-phrases";

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
  /*
    Scott's own About text, Oct 13 2026 ("New about page text"), word for word.
    The paper's name, city, place and email come from the paper's settings; on
    TownReporter they read exactly as Scott wrote them. This is the ONE place
    the paper mentions AI (Scott, Oct 12: "except ONE place and I'll write it").
  */
  return (
    <PaperShell compact>
      <div className="infopage standing-page about-page">
        <span className="eyebrow">{civicReportingLine(PAPER.city)}</span>
        <h1>About {PAPER.name}</h1>
        <p>
          {PAPER.name} is a non-profit newsroom for {PAPER.location}. We read the meeting packets,
          budgets, contracts and public records that most people never see. Then we keep digging
          when something changes, disappears or does not add up.
        </p>
        <h2>Our mission</h2>
        <p>
          {PAPER.city} lost most of its local news coverage. Decisions about your money, your
          streets and your services still get made every week. Our job is to watch those decisions,
          explain them in plain words, and show you the exact documents we used.
        </p>
        <p>
          We are not the city government. We are not the old newspaper. We are a watchdog that shows
          its work.
        </p>
        <h2>How we work</h2>
        <p>
          We use AI to help us research: to find new documents, compare records and track changes
          over time. But {PAPER.name} is a human-run newsroom, and every story goes through a human
          editor before we publish it.
        </p>
        <h2>What we need</h2>
        <ul className="needlist">
          <li>Readers. Read us, and share stories that matter to you.</li>
          <li>Tips. If you know where to look, tell us.</li>
          <li>
            Corrections. If we got something wrong, tell us. We publish every verified correction on
            our <Link to="/corrections">Corrections</Link> page and on the story.
          </li>
        </ul>
        {EDITOR_EMAIL ? (
          <p>
            Write the editor at <a href={`mailto:${EDITOR_EMAIL}`}>{EDITOR_EMAIL}</a>.
          </p>
        ) : null}
        <p className="privacy-note">
          <strong>Your privacy.</strong> No cookies, no accounts, no tracking. We count visits in
          total, never per person.
        </p>
      </div>
    </PaperShell>
  );
}
