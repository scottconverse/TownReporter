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

/*
  ADJUSTED (Scott, Oct 14 2026, coordinator review). This test used to assert
  that "What the editor asked for" and a bare "the prompt" also became the
  supplied document. Both are broad phrases a normal story can say, and both
  have been removed from the render path, so those two assertions are gone --
  they were the only two in this file pinning a removed pattern. The assignment
  reference itself is unchanged and still asserted.
*/
test("the assignment in the prompt becomes the supplied document", () => {
  assert.equal(readerSourceName("the assignment in the prompt"), SUPPLIED_DOCUMENT_NAME);
  /* Mid-sentence, the model's own casing is kept: no stray capital. */
  assert.match(
    readerAppendixText(
      [
        "Claims and sources",
        "Cited to the assignment in the prompt, the desk wrote the outline.",
      ].join("\n"),
    ),
    /^Claims and sources\nCited to the supplied document, the desk wrote the outline\.$/,
  );
});

/*
  THE BROAD PHRASES ARE NOT NAMES (Scott, Oct 14 2026, coordinator review).

  A news story may quote an editor, or print a line reading "The attached
  document", as its own words. Those are the reader's sentences. The rename
  exists for the desk's own file rows and the assignment reference, and for
  nothing else -- so these print character for character, wherever they sit.
*/
/* A literal, escaped, for asserting that a whole block came back untouched. */
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NOT_OUR_NAMES = [
  "What the editor asked for",
  "The editor asked for a shorter piece.",
  "what the editor asked for was a plainer lead.",
  "The attached document",
  "The attached document lists the stops.",
  "An uploaded file was read into the record.",
  "The supplied text runs to nine pages.",
  "the prompt",
  "The prompt asked for two hundred words.",
  "The editor's question in the prompt went unanswered.",
];

test("the broad phrases a story may say on its own are left alone", () => {
  for (const line of NOT_OUR_NAMES) {
    assert.equal(readerSourceName(line), line, `"${line}" must print unchanged`);
  }
});

/* (a) ABOVE the claims section, story prose is never touched -- heading or no. */
test("a story body above the claims section is served unchanged", () => {
  const prose = [
    "The editor asked what the editor asked for, and the desk answered in a memo.",
    "",
    "The attached document lists the stops, and an uploaded file was read into the record.",
    "",
    "The prompt asked for two hundred words; the piece ran long.",
    "",
    "What the editor asked for was a plainer lead.",
  ].join("\n");
  const withHeading = `${prose}\n\nClaims and sources\n- https://example.gov/agenda — the schedule.`;
  assert.equal(readerAppendixText(prose), prose, "a body with no claims heading is returned whole");
  assert.match(readerAppendixText(withHeading), new RegExp(`^${escapeRe(prose)}\\n\\nClaims and sources`));
  /* The same story with the desk's own file named up in the prose: still untouched. */
  const withName = `A memo headed Opinion desk pasted material.txt sits in the file.\n\n${withHeading}`;
  assert.match(readerAppendixText(withName), /^A memo headed Opinion desk pasted material\.txt sits in the file\./);
});

/* (b) INSIDE the section, only the exact names of item 2 change. */
test("inside the claims section only the desk's exact names change", () => {
  const kept = [
    "The attached document lists the stops.",
    "What the editor asked for was a plainer lead.",
    "The prompt asked for two hundred words.",
    "The editor's question in the prompt went unanswered.",
    "An uploaded file was read into the record.",
    "The supplied text runs to nine pages.",
  ];
  const section = ["Claims and sources", ...kept].join("\n");
  assert.equal(readerAppendixText(section), section, "only the exact names change");
  /* And the two exact names DO change, in the same section. */
  const changed = [
    "Claims and sources",
    "- Opinion desk pasted material.txt (page 2) — the ridership figure.",
    "- Opinion desk pasted text — the outline.",
    "- the assignment in the prompt — the framing the editor set.",
  ].join("\n");
  const reader = readerAppendixText(changed);
  assert.match(reader, /- The supplied document \(page 2\) — the ridership figure\./);
  assert.match(reader, /- The supplied document — the outline\./);
  assert.match(reader, /- the supplied document — the framing the editor set\./);
  assert.doesNotMatch(reader, /Opinion desk pasted|the assignment in the prompt/);
});

/* (c) The THV-2 example itself, still corrected at render. */
test("the THV-2 example still becomes the supplied document", () => {
  const section = [
    "Claims and sources",
    "- Opinion desk pasted material.txt (page 2) — the ridership figure.",
    "- the assignment in the prompt — the framing the editor set.",
  ].join("\n");
  const reader = readerAppendixText(section);
  assert.doesNotMatch(reader, /Opinion desk pasted material|the assignment in the prompt/);
  assert.match(reader, /- The supplied document \(page 2\) — the ridership figure\./);
  assert.match(reader, /- the supplied document — the framing the editor set\./);
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
