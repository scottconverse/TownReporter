import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { editorNamesOneAgendaItem, usesWholeMeetingWriter, voteWordsIn } from "./meeting-whole.ts";

/*
  The rules `meeting-whole.ts` still owns after Job 6 (Oct 22 2026).

  The old whole-meeting pipeline -- the window reader, the ledger builder, the
  status pass, the lead and roundup writes -- is gone: nothing called it, since
  the meeting writer became Scott's report-local-news skill run as an agent
  (D200). What the module still holds is what live code imports: the predicate
  that decides whether a lead gets the whole-meeting writer at all, and the
  code-only checks (`voteWordsIn` here) that the civic-reporting path runs on a
  draft. Those two rules are proved here, without a model call or a database.
*/

describe("what meeting-whole.ts still owns", () => {
  it("sends a lead that names one agenda item to the old one-item path", async () => {
    /*
      The whole-meeting writer is the default, but an editor's note that names an
      ordinance, a resolution or an item id asks for THAT item and gets the
      one-item path. A note that only says how to write names nothing, so it
      still gets the whole meeting.
    */
    assert.equal(usesWholeMeetingWriter({ hasMeetingMaterial: true, editorialAssignment: "Lead with the main decision." }), true);
    assert.equal(usesWholeMeetingWriter({ hasMeetingMaterial: true, editorialAssignment: "Write about item 9B2." }), false);
    assert.equal(usesWholeMeetingWriter({ hasMeetingMaterial: true, editorialAssignment: "Cover Ordinance 2026-46." }), false);
    assert.equal(usesWholeMeetingWriter({ hasMeetingMaterial: false, editorialAssignment: "Item 3." }), false);
    // The predicate the wiring reads must agree with the helper it names.
    assert.equal(editorNamesOneAgendaItem("Resolution 2026-12 sets the fee"), true);
    assert.equal(editorNamesOneAgendaItem("plain note with no item"), false);
  });

  it("counts a tally as a vote word only near a vote verb, and never a year range", async () => {
    /*
      Run 4 flagged "20 to 60" (students), "10 to 2" (hours) and "2027-2031"
      (years) as vote words. A tally is a vote word only within a few words of a
      vote verb, and a year range is a year range.
    */
    assert.deepEqual(voteWordsIn("SBDC can help 20 to 60 students."), [], "a count of students is not a vote");
    assert.deepEqual(voteWordsIn("The fair runs from 10 to 2 hours."), [], "hours are not a vote");
    assert.deepEqual(voteWordsIn("The 2027-2031 capital improvement plan was presented."), [], "a year range is not a vote");
    assert.deepEqual(voteWordsIn("The council voted, 5 to 2, but no vote was recorded in the source."), [], "a sentence that denies a vote is never read as one");
    assert.deepEqual(voteWordsIn("The council voted on the 20 to 60 plan in 2027."), [], "a tally beside a year is not the item's vote");
    assert.deepEqual(voteWordsIn("The council voted 5 to 2."), ["5 to 2"], "a tally next to a vote verb is a vote word");
    assert.deepEqual(voteWordsIn("The council acted unanimously."), ["unanimously"], "a unanimous vote is found too");
  });
});
