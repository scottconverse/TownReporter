/*
  RELEASE J, item THV-2 (Scott, Oct 14 2026).

  The boundary the rename depends on: where a body's claims section starts and
  where it stops. It is load-bearing in a way the rename is not -- the rename
  can only touch what is inside this span, so if the span is wrong by a line, a
  story's own prose stops being the reader's.

  The three body shapes are the ones that are live: the model-written appendix
  (`---` then the head), an editor's pasted piece (`## Claims and sources`), and
  a bare heading in any case with an optional colon. The heads that END a
  section are `draft-audit.ts`'s receipts table, because a fact sheet or an
  image prompt under a claims heading is desk furniture too.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { claimsSectionBounds } from "./claims-section.ts";

/** The section as text, for readable assertions. */
const sectionOf = (body: string) => {
  const bounds = claimsSectionBounds(body);
  return bounds ? body.slice(bounds.start, bounds.end) : null;
};

test("every shape a live body uses is found", () => {
  const prose = "The council adopted the budget.";
  const heads = [
    "CLAIMS AND SOURCES",
    "Claims and sources",
    "claims and sources",
    "Claims and sources:",
    "## Claims and sources",
    "**Claims and sources**",
  ];
  for (const head of heads) {
    const body = `${prose}\n\n${head}\n\n- https://example.gov/agenda`;
    assert.equal(
      sectionOf(body),
      `${head}\n\n- https://example.gov/agenda`,
      `"${head}" must open the section`,
    );
  }
});

test("the separator an appendix sets above its head is not part of the section", () => {
  const body = "Prose.\n\n---\n\nCLAIMS AND SOURCES\n\n- https://example.gov/agenda";
  const bounds = claimsSectionBounds(body)!;
  assert.equal(body.slice(bounds.start, bounds.end), "CLAIMS AND SOURCES\n\n- https://example.gov/agenda");
  /* And the prose keeps the rule line, so nothing above the section moves. */
  assert.equal(body.slice(0, bounds.start), "Prose.\n\n---\n\n");
});

test("a story that merely says the phrase has no section at all", () => {
  const bodies = [
    "The editor read the claims and sources section of the record.",
    "Under claims and sources, the desk wrote a note.",
    "Council members asked for the claims and sources behind the figure.",
    "Prose only, with no heading anywhere.",
    "",
  ];
  for (const body of bodies) {
    assert.equal(claimsSectionBounds(body), null, `"${body}" must not open a section`);
  }
});

test("the section stops at the next heading", () => {
  const body = [
    "Prose.",
    "",
    "Claims and sources",
    "",
    "- https://example.gov/agenda — the schedule.",
    "",
    "## Also at the meeting",
    "",
    "The council set a hearing.",
  ].join("\n");
  const section = sectionOf(body)!;
  assert.match(section, /- https:\/\/example\.gov\/agenda/);
  assert.doesNotMatch(section, /Also at the meeting|Council set|hearing/);
});

/*
  `draft-audit.ts` cuts a story at the same heads. They end the claims section
  here for the same reason: an image prompt's own text is not a citation list,
  and a rename running over it would be editing the desk's instructions to a
  model as though they were sources.
*/
test("a receipt head under the claims heading ends the section", () => {
  const body = [
    "Claims and sources",
    "",
    "- https://example.gov/agenda — the schedule.",
    "",
    "EDITOR'S FACT SHEET",
    "",
    "Claim: the fare rose. Source: Opinion desk pasted material.txt, page 3.",
    "",
    "IMAGE PROMPT",
    "",
    "A wide shot of the depot at dawn.",
  ].join("\n");
  const section = sectionOf(body)!;
  assert.match(section, /- https:\/\/example\.gov\/agenda/);
  assert.doesNotMatch(section, /FACT SHEET|IMAGE PROMPT|depot at dawn|fare rose/);
});

test("a heading is found anywhere and runs to the end of the body", () => {
  const body = "Prose one.\n\nMore prose.\n\nClaims and sources\n\n- a\n- b";
  const bounds = claimsSectionBounds(body)!;
  assert.equal(body.slice(0, bounds.start), "Prose one.\n\nMore prose.\n\n");
  assert.equal(body.slice(bounds.end), "");
});

test("the first heading wins when a pasted piece repeats its own", () => {
  const body = [
    "Prose.",
    "",
    "CLAIMS AND SOURCES",
    "",
    "- https://example.gov/agenda",
    "",
    "CLAIMS AND SOURCES",
    "",
    "- https://example.gov/minutes",
  ].join("\n");
  const bounds = claimsSectionBounds(body)!;
  /* The second one is a plain line inside the first section, not a new start. */
  assert.equal(bounds.start, body.indexOf("CLAIMS AND SOURCES"));
  assert.equal(body.slice(bounds.start, bounds.end).includes("example.gov/minutes"), true);
});
