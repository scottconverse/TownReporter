import { it } from "node:test";
import assert from "node:assert/strict";
import { cleanMissingFactNotes, stripReporterNotebook } from "./strip-draft.ts";
import { publicArticle } from "./public.ts";

it("moves the Pace Street schedule-year note out of the reader summary and leaves news copy intact", () => {
  const headline = "Pace Street asphalt plan calls for delays and intersection closures";
  const paceDek =
    "Longmont anticipates milling delays and two to three days of paving impacts near 9th and Mountain View avenues. The notice does not state the schedule year.";
  const note = "The notice does not state the schedule year.";
  const cleaned = cleanMissingFactNotes(`${headline}. ${note}`, paceDek);

  assert.equal(cleaned.headline, headline);
  assert.equal(
    cleaned.dek,
    "Longmont anticipates milling delays and two to three days of paving impacts near 9th and Mountain View avenues.",
  );
  assert.deepEqual(cleaned.notes, [note]);

  const printed = publicArticle({
    id: 1,
    slug: "pace-street",
    headline: `${headline}. ${note}`,
    dek: paceDek,
    body: "Crews will mill asphalt before paving near 9th and Mountain View avenues.",
    topic: "transportation",
    source_urls: "[]",
    status: "published",
    published_at: "2026-10-10T12:00:00Z",
  });
  assert.equal(printed.headline, headline);
  assert.equal(printed.dek, cleaned.dek);
  assert.deepEqual(cleanMissingFactNotes("", "The schedule year is unstated.").notes, [
    "The schedule year is unstated.",
  ]);

  const realNewsDeks = [
    "Longmont crews will mill Pace Street before paving near 9th and Mountain View avenues.",
    "Council's 5-2 vote sends the library plan to a public hearing next month.",
    "A two-week closure will reroute Route 324 while crews replace the downtown signal.",
  ];
  for (const dek of realNewsDeks) {
    assert.equal(cleanMissingFactNotes("Local project moves ahead", dek).dek, dek);
  }

  const body = "The city did not say when work starts.";
  assert.equal(stripReporterNotebook(body), body);
  assert.deepEqual(cleanMissingFactNotes("", body).notes, [body]);
});
