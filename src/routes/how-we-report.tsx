import { createFileRoute } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";

export const Route = createFileRoute("/how-we-report")({ component: How });

function How() {
  return (
    <PaperShell compact>
      <h1 className="enter-fade font-display text-4xl font-semibold">
        How we report
      </h1>
      <div className="stagger-in mt-6 max-w-2xl space-y-4 text-lg leading-7 text-ink-2">
        <p>
          <strong className="text-ink">Sources.</strong> The editor keeps a list
          of official pages: the city, council, planning, NextLight, St. Vrain
          Valley Schools, Boulder County, and the city’s YouTube channel.
          Grok may propose more official URLs. Community apps are signals, not
          sources we quote.
        </p>
        <p>
          <strong className="text-ink">Scan.</strong> On the editor’s click —
          never on a timer — Grok fetches those pages, hashes them against the
          last snapshot, and files leads. Unchanged boilerplate is not news.
        </p>
        <p>
          <strong className="text-ink">Draft.</strong> Wire-service rules:
          attributed claims, no editorializing, no loaded language, no invented
          votes or dollar figures. YouTube captions map topics; they are not
          treated as verbatim quotes.
        </p>
        <p>
          <strong className="text-ink">Gate.</strong> Hold, kill, or publish is
          a person. Beat memory records what already ran so we do not reprint
          yesterday.
        </p>
        <p>
          <strong className="text-ink">Corrections.</strong> Errors get a public
          note. We would rather look careful than look first.
        </p>
      </div>
    </PaperShell>
  );
}
