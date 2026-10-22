import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignmentPrompt,
  EDITOR_FILE_MARKER,
  formatTranscript,
  meetingStamp,
  parseCheckFirst,
  parseSkillStory,
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
    // The publish block keeps the roundup and the claim-by-claim sources.
    assert.match(story.body, /ALSO AT THE MEETING/);
    assert.match(story.body, /CLAIMS AND SOURCES/);
    assert.equal(story.body.includes(EDITOR_FILE_MARKER), false);
    // ...and the editor file starts at the marker and carries the ledger.
    assert.match(story.editorFile, new RegExp(`^${EDITOR_FILE_MARKER}`));
    assert.match(story.editorFile, /MEETING LEDGER/);
    // The proof story has exactly one marker; a second one would mean the
    // split above happened at the wrong place.
    assert.equal(PROOF.split(EDITOR_FILE_MARKER).length - 1, 1);
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
  it("keeps plain sentences, strips list marks, and stops at 30", () => {
    const text = [
      "Check the $36.3 million figure against the packet.",
      "- The mural square footage.",
      "  * The 5 to 2 vote  ",
      "",
      "1. The Nov. 3 second reading.",
    ].join("\n");
    assert.deepEqual(parseCheckFirst(text), [
      "Check the $36.3 million figure against the packet.",
      "The mural square footage.",
      "The 5 to 2 vote",
      "The Nov. 3 second reading.",
    ]);
    assert.equal(parseCheckFirst(Array.from({ length: 40 }, (_, index) => `Item ${index}`).join("\n")).length, 30);
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

  it("carries the limits, and none of this app's internals", () => {
    assert.match(prompt, /Work only inside your working folder/);
    assert.match(prompt, /No questions/);
    for (const banned of ["environment.private.json", ".env", ".private", "session.json", "auth.json"]) {
      assert.ok(prompt.includes(banned), `the prompt names the banned file ${banned}`);
    }
    assert.equal(/TownReporter|deepseek|claude|coordinator/i.test(prompt), false);
  });
});
