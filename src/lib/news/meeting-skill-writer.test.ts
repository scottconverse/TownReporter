import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  apMeetingDate,
  assignmentPrompt,
  claimsAndSourcesUrls,
  EDITOR_FILE_MARKER,
  formatTranscript,
  meetingSourcesLine,
  meetingStamp,
  parseCheckFirst,
  parseSkillStory,
  runNotesOpenedUrls,
} from "./meeting-skill-writer.ts";

/*
  The writer's pure half: what the agent is handed and how its answer is read.
  The fixture is the REAL output of the Oct. 21 proof run (Longmont council,
  Oct. 20 2026) -- public record text a model actually wrote, not a shape these
  tests invented -- so the split is proved against the document it has to work
  on before it works on anything else.
*/

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROOF = readFileSync(join(REPO, "src/lib/news/fixtures/meeting-skill-writer/story-longmont-1020.txt"), "utf8");

describe("parseSkillStory", () => {
  it("splits the proof run into a publishable story and an editor file", () => {
    const story = parseSkillStory(PROOF);
    assert.equal(story.ok, true);
    if (!story.ok) return;
    assert.equal(story.headline, "Longmont adds $36.3 million to 1st and Main transit center");
    assert.match(story.dek, /^The council also approved a development agreement/);
    // The publish block keeps the roundup but NOT the claim-by-claim sources
    // (D217: the list is the editor's checking tool, not reader prose).
    assert.match(story.body, /ALSO AT THE MEETING/);
    assert.equal(story.body.includes("CLAIMS AND SOURCES"), false);
    assert.equal(story.body.includes(EDITOR_FILE_MARKER), false);
    // The block itself comes back whole, heading first.
    assert.match(story.claims, /^CLAIMS AND SOURCES/);
    assert.match(story.claims, /Source \(primary record\)/);
    // ...and the editor file starts at the marker and carries the ledger.
    assert.match(story.editorFile, new RegExp(`^${EDITOR_FILE_MARKER}`));
    assert.match(story.editorFile, /MEETING LEDGER/);
    // The proof story has exactly one marker; a second one would mean the
    // split above happened at the wrong place.
    assert.equal(PROOF.split(EDITOR_FILE_MARKER).length - 1, 1);
  });

  it("moves the claims block to `claims`, and its links stay the draft's sources", () => {
    const story = parseSkillStory(PROOF);
    assert.equal(story.ok, true);
    if (!story.ok) return;
    // The same two records the published body used to list, now read off the
    // editor's copy of the block.
    assert.deepEqual(claimsAndSourcesUrls(story.claims), [
      "https://longmont.primegov.com/public/portal",
      "https://www.youtube.com/watch?v=rsagM9xn28Y",
    ]);
    // The roundup is still the last thing a reader sees under the story.
    assert.equal(story.body.trimEnd().endsWith("at 4th Avenue and Kimbark Street."), true);
  });

  it("takes a horizontal rule above the claims heading with the block", () => {
    const story = parseSkillStory(
      [
        "A headline",
        "",
        "A dek",
        "",
        "The story.",
        "",
        "---",
        "",
        "CLAIMS AND SOURCES",
        "",
        "Claim: a fact. https://example.com/record",
        "",
        EDITOR_FILE_MARKER,
        "",
        "Notes.",
      ].join("\n"),
    );
    assert.equal(story.ok, true);
    if (!story.ok) return;
    assert.equal(story.body, "The story.");
    assert.match(story.claims, /^CLAIMS AND SOURCES/);
    assert.equal(story.claims.includes("---"), false);
  });

  it("returns an empty claims text when the writer wrote no block", () => {
    const story = parseSkillStory(`A headline\n\nA dek\n\nThe story.\n\n${EDITOR_FILE_MARKER}\nnotes\n`);
    assert.equal(story.ok, true);
    if (!story.ok) return;
    assert.equal(story.claims, "");
    assert.equal(story.body, "The story.");
  });

  it("refuses a story with no editor-file marker instead of publishing the notes", () => {
    const story = parseSkillStory("A headline\n\nA dek\n\nA body.\n");
    assert.equal(story.ok, false);
    if (story.ok) return;
    assert.equal(story.reason, "missing-marker");
    assert.match(story.error, /editor file/i);
  });

  it("refuses a story with no headline", () => {
    const story = parseSkillStory(`\n\n${EDITOR_FILE_MARKER}\nnotes\n`);
    assert.equal(story.ok, false);
    if (story.ok) return;
    assert.equal(story.reason, "empty-headline");
  });

  it("refuses a headline with no story under it", () => {
    const story = parseSkillStory(`A headline\n\nA dek\n\n${EDITOR_FILE_MARKER}\nnotes\n`);
    assert.equal(story.ok, false);
    if (story.ok) return;
    assert.equal(story.reason, "empty-body");
  });
});

describe("parseCheckFirst", () => {
  it("keeps plain sentences, strips list marks, and keeps at most 3", () => {
    const text = [
      "Check the $36.3 million figure against the packet.",
      "- The mural square footage.",
      "  * The 5 to 2 vote  ",
      "",
      "1. The Nov. 3 second reading.",
    ].join("\n");
    // Three survive; the fourth line is dropped, not merged or reordered.
    assert.deepEqual(parseCheckFirst(text), [
      "Check the $36.3 million figure against the packet.",
      "The mural square footage.",
      "The 5 to 2 vote",
    ]);
    // Scott's rule (Oct 7, D204): an editor checks 1 to 3 things, not thirty.
    assert.deepEqual(
      parseCheckFirst(Array.from({ length: 40 }, (_, index) => `Item ${index}`).join("\n")),
      ["Item 0", "Item 1", "Item 2"],
    );
    assert.deepEqual(parseCheckFirst(""), []);
  });
});

describe("formatTranscript", () => {
  it("writes the header the skill's citations rely on, then one stamped line per caption", () => {
    const text = formatTranscript(
      "Longmont City Council Regular Session - October 20, 2026",
      "October 20, 2026",
      "rsagM9xn28Y",
      [
        { startSeconds: 19, excerpt: " Thank you. " },
        { startSeconds: 20287, excerpt: "Motion carries." },
      ],
    );
    const lines = text.split("\n");
    // The title already carries the date; it is not said twice.
    assert.equal(
      lines[0],
      "Longmont City Council Regular Session - October 20, 2026. YouTube rsagM9xn28Y. Full captions, 2 lines, 0:00:19 to 5:38:07.",
    );
    assert.equal(lines[1], "");
    assert.equal(lines[2], "0:00:19  Thank you.");
    assert.equal(lines[3], "5:38:07  Motion carries.");
  });

  it("adds the date when the title does not carry it", () => {
    const text = formatTranscript("City Council Regular Session", "October 20, 2026", "abc", [
      { startSeconds: 0, excerpt: "One." },
    ]);
    assert.match(text, /^City Council Regular Session - October 20, 2026\. YouTube abc\./);
  });

  it("stamps hours unpadded and minutes and seconds in two digits", () => {
    assert.equal(meetingStamp(0), "0:00:00");
    assert.equal(meetingStamp(19), "0:00:19");
    assert.equal(meetingStamp(3_600), "1:00:00");
    assert.equal(meetingStamp(20_287), "5:38:07");
    assert.equal(meetingStamp(36_000), "10:00:00");
  });
});

describe("assignmentPrompt", () => {
  const prompt = assignmentPrompt({
    title: "Longmont City Council Regular Session",
    date: "October 20, 2026",
    videoId: "rsagM9xn28Y",
    lineCount: 7958,
    firstStamp: "0:00:19",
    lastStamp: "5:36:07",
    today: "Wednesday, Oct. 21, 2026",
  });

  it("hands the agent the skill as its only rule set", () => {
    assert.match(prompt, /Read ALL of it first/);
    assert.match(prompt, /SKILL\.md/);
    assert.match(prompt, /Today is Wednesday, Oct\. 21, 2026/);
    assert.match(prompt, /Meeting mode/);
  });

  it("names the transcript, the audit command, and every output file", () => {
    assert.match(prompt, /transcript\.txt/);
    assert.match(prompt, /7,958 lines, 0:00:19 to 5:36:07/);
    assert.match(prompt, /python scripts\/audit\.py draft\.txt --meeting/);
    assert.match(prompt, /curl and pdftotext/);
    assert.match(prompt, /story\.txt/);
    assert.match(prompt, /audit-final\.txt/);
    assert.match(prompt, /CHECK-FIRST\.txt/);
    assert.match(prompt, /RUN-NOTES\.md/);
    assert.match(prompt, /Last line: RUN-DONE/);
  });

  it("asks for at most 3 CHECK-FIRST items, most harmful first", () => {
    assert.match(
      prompt,
      /Write CHECK-FIRST\.txt: AT MOST 3 lines, the items an editor must check before publishing that would do the most harm if wrong, most harmful first/,
    );
    assert.match(prompt, /Everything else you flagged stays in the EDITOR FILE, not here\./);
    assert.match(prompt, /If nothing rises to that level, write an empty file\./);
  });

  it("carries the limits, and none of this app's internals", () => {
    assert.match(prompt, /Work only inside your working folder/);
    assert.match(prompt, /No questions/);
    for (const banned of ["environment.private.json", ".env", ".private", "session.json", "auth.json"]) {
      assert.ok(prompt.includes(banned), `the prompt names the banned file ${banned}`);
    }
    assert.equal(/TownReporter|deepseek|claude|coordinator/i.test(prompt), false);
  });
});

describe("apMeetingDate", () => {
  it("writes an AP date and never moves the day", () => {
    assert.equal(apMeetingDate("October 20, 2026"), "Oct. 20, 2026");
    assert.equal(apMeetingDate("2026-10-20"), "Oct. 20, 2026");
    assert.equal(apMeetingDate("September 3, 2026"), "Sept. 3, 2026");
    // The five short months stay spelled out.
    assert.equal(apMeetingDate("March 4, 2026"), "March 4, 2026");
    assert.equal(apMeetingDate("July 4, 2026"), "July 4, 2026");
    assert.equal(apMeetingDate("August 1, 2026"), "Aug. 1, 2026");
  });

  it("returns nothing for text it cannot read as a date", () => {
    assert.equal(apMeetingDate(""), "");
    assert.equal(apMeetingDate("last Tuesday"), "");
    assert.equal(apMeetingDate("Smarch 4, 2026"), "");
  });
});

describe("meetingSourcesLine", () => {
  it("links the tape and this meeting's packet in one sentence", () => {
    assert.equal(
      meetingSourcesLine({
        date: "October 20, 2026",
        videoId: "rsagM9xn28Y",
        title: "Longmont City Council Regular Session",
        packetUrl: "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=9",
      }),
      "Sources: [Oct. 20, 2026 meeting video](https://www.youtube.com/watch?v=rsagM9xn28Y) and [council packet](https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=9).",
    );
  });

  it("leaves the packet as plain words when there is no packet to link", () => {
    assert.equal(
      meetingSourcesLine({ date: "October 20, 2026", videoId: "abc", title: "Council", packetUrl: null }),
      "Sources: [Oct. 20, 2026 meeting video](https://www.youtube.com/watch?v=abc) and council packet.",
    );
  });

  it("says meeting packet for a body that is not the council, and drops an unknown date", () => {
    assert.equal(
      meetingSourcesLine({ date: "", videoId: "abc", title: "Planning and Zoning Commission", packetUrl: null }),
      "Sources: [meeting video](https://www.youtube.com/watch?v=abc) and meeting packet.",
    );
  });
});

describe("claimsAndSourcesUrls", () => {
  it("takes the https links from the CLAIMS AND SOURCES block, deduped and in order", () => {
    const urls = claimsAndSourcesUrls(PROOF);
    assert.ok(urls.length > 0);
    assert.deepEqual(urls, [
      "https://longmont.primegov.com/public/portal",
      "https://www.youtube.com/watch?v=rsagM9xn28Y",
    ]);
    assert.equal(urls.every((url) => url.startsWith("https://")), true);
  });

  it("reads nothing before the block and drops an http link", () => {
    const body = [
      "A link in the story body is not a source line: https://example.com/in-body",
      "",
      "CLAIMS AND SOURCES",
      "",
      "Claim: A fact.",
      "Source: a page. https://example.com/record.",
      "Source: an old page. http://example.com/not-secure",
    ].join("\n");
    assert.deepEqual(claimsAndSourcesUrls(body), ["https://example.com/record"]);
  });
});

describe("runNotesOpenedUrls", () => {
  it("takes the records opened from the heading form a real run wrote (job-442)", () => {
    const runNotes = [
      "# RUN NOTES, job 442",
      "",
      "## Records opened",
      "",
      "RTD news release, Oct. 13, 2026.",
      "https://www.rtd-denver.com/community/news/rtd-budget",
      "",
      "RTD budget page.",
      "https://www.rtd-denver.com/budget",
      "",
      "Budget book (marked DRAFT), 114 pages.",
      "https://cdn.rtd-denver.com/files/FY2027_Budget_Book.pdf",
      "",
      "## What I could not get, and why",
      "",
      "A transcript: https://not-a-record.example.com/transcript",
    ].join("\n");
    assert.deepEqual(runNotesOpenedUrls(runNotes), [
      "https://www.rtd-denver.com/community/news/rtd-budget",
      "https://www.rtd-denver.com/budget",
      "https://cdn.rtd-denver.com/files/FY2027_Budget_Book.pdf",
    ]);
  });

  it("takes the plain-line form, with a note in parentheses after each URL (job-444)", () => {
    const runNotes = [
      "RUN NOTES",
      "",
      "Records opened (all fetched and read this session):",
      "https://coloradosun.com/2026/10/23/heat-pumps/ (supplied article, read in full)",
      "https://rmi.org/resources/heat-pumps/ (report page, executive summary)",
      "https://longmontcolorado.gov/news/bundling-up/ (LPC blog, March 17, 2025)",
      "",
      "What could not be obtained and why:",
      "Platte River's site returned a 403.",
      "Final script result: RESULT: MECHANICAL CHECKS CLEAR.",
      "Ranking record: not applicable.",
      "RUN-DONE",
    ].join("\n");
    assert.deepEqual(runNotesOpenedUrls(runNotes), [
      "https://coloradosun.com/2026/10/23/heat-pumps/",
      "https://rmi.org/resources/heat-pumps/",
      "https://longmontcolorado.gov/news/bundling-up/",
    ]);
  });

  it("never takes a URL from the part about what could not be got", () => {
    const runNotes = [
      "Records opened:",
      "https://example.gov/read-this",
      "",
      "Could not get: https://example.gov/blocked-page",
      "https://example.gov/also-blocked",
    ].join("\n");
    assert.deepEqual(runNotesOpenedUrls(runNotes), ["https://example.gov/read-this"]);
  });

  it("gives nothing when the notes never say records opened", () => {
    assert.deepEqual(runNotesOpenedUrls("RUN NOTES\nhttps://example.gov/a\nRUN-DONE"), []);
    assert.deepEqual(runNotesOpenedUrls(""), []);
  });

  it("strips trailing punctuation, drops http, and keeps each URL once", () => {
    const runNotes = [
      "## Records opened",
      "https://example.gov/one.",
      "https://example.gov/two;",
      "https://example.gov/one",
      "http://example.gov/not-secure",
      "https://example.gov/three)",
    ].join("\n");
    assert.deepEqual(runNotesOpenedUrls(runNotes), [
      "https://example.gov/one",
      "https://example.gov/two",
      "https://example.gov/three",
    ]);
  });

  it("caps the list", () => {
    const runNotes = [
      "Records opened:",
      ...Array.from({ length: 45 }, (_, index) => `https://example.gov/page-${index + 1}`),
    ].join("\n");
    const urls = runNotesOpenedUrls(runNotes);
    assert.equal(urls.length, 40);
    assert.equal(urls[0], "https://example.gov/page-1");
    assert.equal(urls[39], "https://example.gov/page-40");
  });
});
