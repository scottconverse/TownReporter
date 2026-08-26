import { createFileRoute } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { PAPER } from "@/lib/paper";

export const Route = createFileRoute("/about")({ component: About });

function About() {
  return (
    <PaperShell compact>
      <h1 className="enter-fade font-display text-4xl font-semibold">
        About this paper
      </h1>
      <div className="stagger-in mt-6 max-w-2xl space-y-4 text-lg leading-7 text-ink-2">
        <p>
          {PAPER.name} is a civic newspaper for {PAPER.location}. It watches the
          public record — council, planning, utilities, schools — and prints
          what an editor is willing to sign.
        </p>
        <p>
          Grok works the desk: fetching sources, filing leads, drafting recaps
          under wire-service rules. A human editor-in-chief still has to publish.
          There is no fully automated path to the masthead.
        </p>
        <p>
          We are not the Longmont Times-Call, not the city, and not a replacement
          for either. We cover the meetings and packets most people never sit
          through, and we always point back to the primary source when we have
          one.
        </p>
        <p>
          This edition runs as a hosted experiment. Drafts and source lists live
          on the desk behind a sign-in. The public archive is the paper you are
          reading.
        </p>
      </div>
    </PaperShell>
  );
}
