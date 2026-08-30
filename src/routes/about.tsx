import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { EDITOR_EMAIL, PAPER } from "@/lib/paper";

export const Route = createFileRoute("/about")({
  /*
    Its own title. Every standing page shared the site's title, so a reader with
    the paper open in several tabs could not tell them apart, and search results
    listed them all under one name.
  */
  head: () => ({ meta: [{ title: `About this paper — ${PAPER.name}` }] }),
  component: About,
});

function About() {
  return (
    <PaperShell compact>
      <h1 className="enter-fade font-display text-4xl font-semibold">
        About this paper
      </h1>
      <p className="mt-3 text-[11px] tracking-[0.16em] text-rust uppercase">
        Independent civic reporting for {PAPER.city}
      </p>
      <div className="stagger-in mt-6 max-w-2xl space-y-4 text-lg leading-7 text-ink-2">
        <p>
          {PAPER.name} is a local civic newsroom and investigative record system
          for {PAPER.location}. The public record is only the beginning.
        </p>
        <p>
          We follow Longmont’s meetings, money, contracts and public records —
          then keep digging when something changes, disappears or doesn’t add
          up. A human editor still decides what is published. There is no
          fully automated path to the masthead. {PAPER.trust}
        </p>
        <p>
          The source list is where reporting starts, not where it stops. We
          watch known civic pages, notice new documents and anomalies, follow
          names and contracts off that list, compare records over time, and
          keep copies of significant material. Dark Desk is the recursive
          investigative lane: competing hypotheses, historical versions, and
          trails the announcing source did not include.
        </p>
        <p>
          We are not the Longmont Times-Call, not the city, and not a
          replacement for either. We cover the packets most people never sit
          through, and we show the exact documents we used.
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
    </PaperShell>
  );
}
