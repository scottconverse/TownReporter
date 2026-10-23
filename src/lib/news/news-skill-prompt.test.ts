import assert from "node:assert/strict";
import { test } from "node:test";
import { newsAssignmentPrompt, newsLeadFile } from "./meeting-skill-writer.ts";

/*
  D234: the assignment handed to the news writer.

  The text is the arm-C harness's prompt (writer-test-c/harness/run-c.mjs lines
  75-100) word for word -- the blind test measured that wording, so it is
  copied rather than improved. These assertions hold the two things that make
  it the same assignment: the one-lead frame and the lead's own words.
*/

test("the news assignment is one straight story about this one lead", () => {
  const prompt = newsAssignmentPrompt({
    headline: "Longmont weighs the housing plan",
    topic: "housing",
    today: "Wednesday, Oct. 21, 2026",
  });
  assert.match(prompt, /Today is Wednesday, Oct\. 21, 2026 \(America\/Denver\)\./);
  assert.match(
    prompt,
    /Write ONE straight local news story about ONE lead: "Longmont weighs the housing plan" \(topic: housing\)\./,
  );
  assert.match(prompt, /there is no transcript, no packet, no ALSO AT THE MEETING section, and no ledger/);
  assert.match(prompt, /The lead, its evidence and every source URL are in LEAD\.md/);
  assert.match(prompt, /python scripts\/audit\.py draft\.txt/);
  assert.match(prompt, /Write CHECK-FIRST\.txt: AT MOST 3 lines/);
  assert.match(prompt, /Never open or print environment\.private\.json/);
  assert.match(prompt, /No questions: nobody can answer/);
});

test("the lead file carries every field the desk holds for the lead", () => {
  const file = newsLeadFile({
    id: 720,
    headline: "Longmont weighs the housing plan",
    why: "A vote is scheduled",
    topic: "housing",
    sourceUrls: ["https://records.example.gov/ordinance-2026-14"],
    evidence: "Staff report says 700 units",
    notesJson: '{"editorAssignment":"Keep it short"}',
  });
  assert.match(file, /^# LEAD 720/);
  assert.match(file, /## Headline\nLongmont weighs the housing plan/);
  assert.match(file, /## Why it is news\nA vote is scheduled/);
  assert.match(file, /## Topic\nhousing/);
  assert.match(file, /## Source URLs\n- https:\/\/records\.example\.gov\/ordinance-2026-14/);
  assert.match(file, /## Evidence\nStaff report says 700 units/);
  assert.match(file, /## Editor's notes \(reporting leads, not established facts\)\n\{"editorAssignment"/);
});

test("a lead with no source URLs says so instead of leaving the section blank", () => {
  const file = newsLeadFile({
    id: 1,
    headline: "Headline",
    why: "",
    topic: "",
    sourceUrls: [],
    evidence: "",
    notesJson: null,
  });
  assert.match(file, /## Source URLs\n- \(none supplied\)/);
});
