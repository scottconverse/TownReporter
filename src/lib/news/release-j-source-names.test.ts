/*
  RELEASE J, item THV-2 (Scott, Oct 14 2026).

  The public page of "OPINION: Keep the A Line at 15 minutes -- and say plainly
  when it comes back" printed, under Claims and sources, a filename from the
  newsroom's own file store ("Opinion desk pasted material.txt") and a
  reference to the prompt the desk wrote ("the assignment in the prompt"). The
  reader was shown the inside of the desk.

  Scott's words for the replacement are exact: "the supplied document". This
  file pins BOTH halves of that -- the internal names change, and an ordinary
  source line is returned character for character, because the whole value of
  an appendix is that it says precisely what was read.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArticleRow } from "./types.ts";
import { publicArticle } from "./public.ts";
import {
  SUPPLIED_DOCUMENT_NAME,
  readerAppendixText,
  readerSourceName,
} from "./reader-source-names.ts";

/* A filename standing alone keeps the desk's capital: "The supplied document". */
test("the desk's pasted-material filename becomes the supplied document", () => {
  assert.equal(readerSourceName("Opinion desk pasted material.txt"), "The supplied document");
  assert.equal(readerSourceName("Opinion desk pasted material"), "The supplied document");
  assert.equal(readerSourceName("Opinion desk pasted text.txt"), "The supplied document");
});

test("the prompt and the assignment become the supplied document", () => {
  assert.equal(readerSourceName("the assignment in the prompt"), SUPPLIED_DOCUMENT_NAME);
  assert.equal(readerSourceName("What the editor asked for"), "The supplied document");
  assert.equal(readerSourceName("the prompt"), SUPPLIED_DOCUMENT_NAME);
  /* Mid-sentence, the model's own casing is kept: no stray capital. */
  assert.match(
    readerAppendixText("Cited to the assignment in the prompt, the desk wrote the outline."),
    /^Cited to the supplied document, the desk wrote the outline\.$/,
  );
});

/* A pasted editorial's appendix is one source to a line, most of them bullets. */
test("an appendix bullet naming an internal file keeps its locator", () => {
  const appendix = [
    "Claims and sources",
    "- Opinion desk pasted material.txt (page 2) — the ridership figure.",
    "- https://example.gov/agenda — the published schedule.",
  ].join("\n");
  const reader = readerAppendixText(appendix);
  assert.match(reader, /- The supplied document \(page 2\) — the ridership figure\./);
  assert.match(reader, /- https:\/\/example\.gov\/agenda — the published schedule\./);
});

/*
  THE LOAD-BEARING CASE. An ordinary source line names a record a reader can
  go and check; rewriting it would make the paper's own appendix untrustworthy.
*/
test("an ordinary source line is returned unchanged", () => {
  const lines = [
    "Longmont City Council agenda, Sept. 22, 2026 (Attachment G, page 4)",
    "https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=91",
    "The Colorado Sun, \"RTD weighs a shorter A Line\" (Aug. 3, 2026)",
    "RTD A Line service plan, 2026, section 3.2",
  ];
  for (const line of lines) {
    assert.equal(readerSourceName(line), line, `"${line}" must print unchanged`);
  }
  const appendix = lines.join("\n");
  assert.equal(readerAppendixText(appendix), appendix);
});

test("a line with no internal name is never disturbed, whitespace and all", () => {
  const appendix = "  Claims and sources\n\n- https://example.gov/agenda\n";
  assert.equal(readerAppendixText(appendix), appendix);
});

test("the corrected wording is stable under a second pass", () => {
  const once = readerAppendixText("- Opinion desk pasted material.txt");
  assert.equal(readerAppendixText(once), once);
  assert.equal(readerAppendixText(`- ${SUPPLIED_DOCUMENT_NAME}`), `- ${SUPPLIED_DOCUMENT_NAME}`);
});

/*
  THE RENDER PATH ITSELF, because a published piece is corrected at render and
  never rewritten in the store. This is the reader's page: `publicArticle` is
  what the route draws, so an already-published opinion whose stored body names
  the desk's own file must come out of it with the reader's words.
*/
function article(body: string): ArticleRow {
  return {
    id: 1,
    user_id: "editor",
    newsroom_id: 1,
    lead_id: 1,
    slug: "opinion-a-line",
    headline: "OPINION: Keep the A Line at 15 minutes",
    dek: "",
    body,
    topic: "transit",
    source_urls: "[]",
    status: "published",
    published_at: "2026-10-10T00:00:00.000Z",
    provenance_json: "[]",
    form: "opinion",
    found_note: "[]",
  } as unknown as ArticleRow;
}

test("a published opinion's stored appendix is corrected as the reader is served it", () => {
  const stored = [
    "The A Line should stay at 15 minutes.",
    "---",
    "CLAIMS AND SOURCES",
    "- Opinion desk pasted material.txt (page 2) — the ridership figure.",
    "- the assignment in the prompt — the framing the editor set.",
    "- https://rtd-denver.com/schedules/line-a — the published schedule.",
  ].join("\n\n");
  const served = publicArticle(article(stored)).body;
  assert.doesNotMatch(
    served,
    /Opinion desk pasted material|the assignment in the prompt/,
    "the reader is still shown the inside of the desk",
  );
  assert.match(served, /- [Tt]he supplied document \(page 2\) — the ridership figure\./);
  assert.match(served, /- the supplied document — the framing the editor set\./);
  assert.match(served, /- https:\/\/rtd-denver\.com\/schedules\/line-a — the published schedule\./);
});

test("a published reported story's ordinary sources are served untouched", () => {
  const stored = [
    "Council approved the noise policy.",
    "---",
    "CLAIMS AND SOURCES",
    "- Longmont City Council agenda, Sept. 22, 2026 (Attachment G, page 4)",
    "- The Colorado Sun, \"RTD weighs a shorter A Line\" (Aug. 3, 2026)",
  ].join("\n\n");
  assert.equal(publicArticle(article(stored)).body, stored);
});
