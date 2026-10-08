// guards: an editor must not lose a file, its waiting state, or its queue evidence
import { it } from "node:test";
import assert from "node:assert/strict";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { getSql } from "../db.ts";
import {
  closeInvestigationFor,
  ensureDarkSchema,
  listInvestigationsFor,
  openInvestigationForEditor,
  queuePacketFor,
} from "./dark.ts";
import { investigationPileFor } from "./desk-copy.ts";
import { performCreateAiFollowUp } from "./follow-ups.ts";
import { createPageWatchFor } from "./page-watch.ts";

await applyMigrationsToTestPglite();

it("keeps linked files waiting and saves a readable no-finding decision and queue packet", async () => {
  const sql = await getSql();
  await ensureDarkSchema();
  const userId = `dark-disposition-${Date.now()}`;
  const newsroomId = 98125;
  const followFile = await openInvestigationForEditor(userId, {
    paste: "A public record question.",
    title: "Waiting on a public notice",
  }, newsroomId);
  const follow = await performCreateAiFollowUp({ userId, newsroomId }, {
    what: "Find the next public notice",
    agentKind: "search",
    schedule: "daily",
    investigationId: followFile.investigationId,
  });
  assert.equal(follow.ok, true);
  const watchFile = await openInvestigationForEditor(userId, {
    paste: "Watch a source page.",
    title: "Waiting on a page",
  }, newsroomId);
  const watch = await createPageWatchFor({ userId, newsroomId }, {
    url: `https://records-${Date.now()}.example/notices`,
    name: "Public notices",
    reason: "Check for the next notice",
    investigationId: watchFile.investigationId,
  });
  assert.equal(watch.ok, true);
  const closedFile = await openInvestigationForEditor(userId, {
    paste: "A question with one sourced claim.",
    title: "Closed without a finding",
    ordinaryExplanation: "A routine update could explain it.",
  }, newsroomId);
  await sql`
    insert into claims (user_id, newsroom_id, investigation_id, body, kind, evidence, source_url)
    values (${userId}, ${newsroomId}, ${closedFile.investigationId},
      'The notice lists a revised meeting date.', 'FACT', 'Captured notice', 'https://records.example/notice')
  `;
  await sql`
    insert into investigation_briefs (investigation_id, newsroom_id, brief_json)
    values (${closedFile.investigationId}, ${newsroomId}, ${JSON.stringify({
      headline: "Meeting date revised",
      benign: "The notice may reflect a routine schedule change.",
      kills_it: "A later notice confirms the original date.",
      contradictions: [{
        first: { text: "The meeting is Tuesday.", captureId: 11 },
        second: { text: "The meeting is Thursday.", captureId: 12 },
      }],
    })})
  `;
  const closed = await closeInvestigationFor(userId, newsroomId, closedFile.investigationId, "No record supports the claim.");
  const files = await listInvestigationsFor(newsroomId);
  const followRow = files.find((row) => row.id === followFile.investigationId)!;
  const watchRow = files.find((row) => row.id === watchFile.investigationId)!;
  assert.equal(investigationPileFor(followRow), "waiting");
  assert.equal(followRow.waiting_follow_up, "Find the next public notice");
  assert.equal(investigationPileFor(watchRow), "waiting");
  assert.equal(watchRow.waiting_watch, "Check for the next notice");
  assert.equal(closed.ok, true);
  assert.equal(investigationPileFor(files.find((row) => row.id === closedFile.investigationId)!), "aside");
  const disposition = await sql<{ closed_kind: string; close_note: string }>`
    select closed_kind, close_note from investigations where id = ${closedFile.investigationId}
  `;
  assert.deepEqual(disposition, [{ closed_kind: "no-finding", close_note: "No record supports the claim." }]);
  const packet = await queuePacketFor(newsroomId, closedFile.investigationId);
  assert.equal(packet?.suggestedHeadline, "Unverified lead: Meeting date revised");
  assert.deepEqual(packet?.evidence, [{
    text: "The notice lists a revised meeting date.",
    source: "https://records.example/notice",
  }]);
  assert.equal(packet?.uncertainties.includes("A routine update could explain it."), true);
  assert.deepEqual(packet?.contradictions[0]?.first, { text: "The meeting is Tuesday.", captureId: 11 });
  assert.equal(packet?.whatWouldDisproveIt.includes("A later notice confirms the original date."), true);
  assert.equal(packet?.publicationNotice, "Publication remains an editorial decision.");
});
