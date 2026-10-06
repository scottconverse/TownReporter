import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSql, type Sql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { recordObservation } from "./source-observations.server.ts";
import {
  emptyReportingPackage,
} from "./civic-reporting.ts";
import {
  ensureReportingSchema,
  loadLeadReportingPackage,
  relevantReportingObservations,
  saveReportingObservation,
  saveReportingPackage,
} from "./civic-reporting.server.ts";

await applyMigrationsToTestPglite();

const USER_ID = `civic-reporting-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const NEWSROOM_ID = 300_000 + Math.floor(Math.random() * 500_000);
const OTHER_NEWSROOM_ID = NEWSROOM_ID + 1;

async function insertLead(sql: Sql, newsroomId: number, headline: string): Promise<number> {
  const [row] = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, status)
    values (${USER_ID}, ${newsroomId}, ${headline}, ${"A test reporting lead."}, ${"council"}, ${"new"})
    returning id
  `;
  assert.ok(row);
  return Number(row.id);
}

async function insertRequest(sql: Sql, newsroomId: number, leadId: number | null): Promise<number> {
  const [row] = await sql<{ id: number }>`
    insert into reporting_requests
      (user_id, newsroom_id, request_kind, lead_id, action, assignment, method_version)
    values (${USER_ID}, ${newsroomId}, ${"lead"}, ${leadId}, ${"Develop this lead"},
            ${"Check the assignment-specific observations."}, ${"2.6.0"})
    returning id
  `;
  assert.ok(row);
  return Number(row.id);
}

async function insertSource(sql: Sql, userId: string, newsroomId: number, url: string): Promise<number> {
  const [row] = await sql<{ id: number }>`
    insert into sources (user_id, newsroom_id, url, title)
    values (${userId}, ${newsroomId}, ${url}, ${url})
    returning id
  `;
  assert.ok(row);
  return Number(row.id);
}

async function insertDraft(
  sql: Sql,
  newsroomId: number,
  leadId: number,
  research: unknown,
): Promise<number> {
  const [row] = await sql<{ id: number }>`
    insert into drafts (
      user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls,
      provenance_json, disclosure_text, research_json
    ) values (
      ${USER_ID}, ${newsroomId}, ${leadId}, ${"Test story"}, ${"Test brief"},
      ${"A full test draft for storage readback."}, ${"council"}, ${"[]"}, ${"[]"},
      ${"Civic reporting fixture."}, ${JSON.stringify(research)}
    ) returning id
  `;
  assert.ok(row);
  return Number(row.id);
}

describe("civic reporting storage", () => {
  it("saves and retrieves only assignment-scoped observations and reads secondary story packages", async () => {
    const sql = await getSql();
    await ensureReportingSchema(sql);

    const leadId = await insertLead(sql, NEWSROOM_ID, "Assignment lead");
    const unrelatedLeadId = await insertLead(sql, NEWSROOM_ID, "Unrelated lead");
    const otherNewsroomLeadId = await insertLead(sql, OTHER_NEWSROOM_ID, "Other newsroom lead");
    const parentRequestId = await insertRequest(sql, NEWSROOM_ID, leadId);
    const unrelatedRequestId = await insertRequest(sql, NEWSROOM_ID, unrelatedLeadId);
    const seedUrl = "https://city.example/packet.pdf";
    const otherUrl = "https://city.example/unrelated.pdf";
    const seedSourceId = await insertSource(sql, USER_ID, NEWSROOM_ID, seedUrl);
    const otherSourceId = await insertSource(sql, USER_ID, NEWSROOM_ID, otherUrl);
    const foreignSeedSourceId = await insertSource(sql, USER_ID + "-other", OTHER_NEWSROOM_ID, seedUrl);

    await saveReportingObservation(sql, {
      newsroomId: NEWSROOM_ID,
      userId: USER_ID,
      requestId: parentRequestId,
      kind: "retrieval",
      text: "The parent assignment could not retrieve its archived minutes.",
      evidence: "https://city.example/archive/minutes",
    });
    await saveReportingObservation(sql, {
      newsroomId: NEWSROOM_ID,
      userId: USER_ID,
      leadId,
      sourceId: seedSourceId,
      kind: "correction",
      text: "The editor corrected the meeting date to September 29.",
      evidence: "https://city.example/minutes#date",
    });
    await saveReportingObservation(sql, {
      newsroomId: NEWSROOM_ID,
      userId: USER_ID,
      leadId: unrelatedLeadId,
      requestId: unrelatedRequestId,
      kind: "source",
      text: "This belongs to another assignment.",
      evidence: "https://city.example/other-assignment",
    });
    await saveReportingObservation(sql, {
      newsroomId: OTHER_NEWSROOM_ID,
      userId: USER_ID + "-other",
      leadId: leadId,
      requestId: parentRequestId,
      sourceId: seedSourceId,
      kind: "correction",
      text: "Cross-newsroom correction must stay out.",
      evidence: "https://other.example/correction",
    });

    // Make automated rows newer than the saved correction. The correction must
    // still survive the bounded context returned to the next assignment.
    await sql.query(
      `insert into reporting_observations
        (newsroom_id, user_id, lead_id, kind, text, evidence, created_at)
       select $1, $2, $3, 'disposition', 'Automated disposition noise', 'system receipt',
              now() + (series * interval '1 second')
         from generate_series(1, 130) as series`,
      [NEWSROOM_ID, USER_ID, leadId],
    );

    const editorCorrectionId = await recordObservation({
      newsroomId: NEWSROOM_ID,
      sourceId: seedSourceId,
      kind: "corrected-draft",
      note: "The editor corrected this source's date reference.",
      leadId,
      observedBy: "editor",
    }, sql);
    assert.ok(editorCorrectionId);
    await recordObservation({
      newsroomId: NEWSROOM_ID,
      sourceId: seedSourceId,
      kind: "retrieval-error",
      note: "The archive timed out on the latest retrieval.",
      observedBy: "system",
    }, sql);
    await recordObservation({
      newsroomId: NEWSROOM_ID,
      sourceId: otherSourceId,
      kind: "quiet",
      note: "This source was quiet, but it was not supplied for this assignment.",
      observedBy: "system",
    }, sql);
    await recordObservation({
      newsroomId: OTHER_NEWSROOM_ID,
      sourceId: foreignSeedSourceId,
      kind: "corrected-draft",
      note: "A different newsroom corrected its copy.",
      observedBy: "editor",
    }, sql);
    // A lead-scoped note is useful even when its source was not one of the seeds.
    await recordObservation({
      newsroomId: NEWSROOM_ID,
      sourceId: otherSourceId,
      kind: "verified-claim",
      note: "This source verified a claim for the current lead.",
      leadId,
      observedBy: "reporting",
    }, sql);
    // Same newsroom, unrelated lead: it must not enter through a global query.
    await recordObservation({
      newsroomId: NEWSROOM_ID,
      sourceId: otherSourceId,
      kind: "corrected-draft",
      note: "A correction for a different lead.",
      leadId: unrelatedLeadId,
      observedBy: "editor",
    }, sql);
    // A foreign newsroom has the exact same URL, but its own source ID and
    // observation must not be pulled in by URL matching.
    assert.ok(otherNewsroomLeadId > 0);

    const observations = await relevantReportingObservations(sql, {
      newsroomId: NEWSROOM_ID,
      leadId,
      parentRequestId,
      seedUrls: [seedUrl],
    });
    const editorCorrection = observations.find((item) => item.text.includes("editor corrected the meeting date"));
    assert.ok(editorCorrection, "a human reporting correction survives newer automated noise");
    assert.deepEqual(editorCorrection.scope, ["lead", "seed-source"]);
    assert.equal(editorCorrection.origin, "reporting");
    assert.equal(editorCorrection.sourceId, seedSourceId);
    assert.equal(editorCorrection.evidence, "https://city.example/minutes#date");
    assert.ok(Number.isFinite(Date.parse(editorCorrection.createdAt)), "the returned correction has a date");

    const parent = observations.find((item) => item.text.includes("parent assignment could not retrieve"));
    assert.ok(parent);
    assert.deepEqual(parent.scope, ["parent-request"]);
    assert.equal(parent.requestId, parentRequestId);
    assert.equal(parent.evidence, "https://city.example/archive/minutes");

    const sourceCorrection = observations.find((item) => item.id === editorCorrectionId && item.origin === "source");
    assert.ok(sourceCorrection);
    assert.deepEqual(sourceCorrection.scope, ["lead", "seed-source"]);
    assert.equal(sourceCorrection.sourceId, seedSourceId);
    assert.equal(sourceCorrection.observedBy, "editor");
    assert.equal(sourceCorrection.evidence, seedUrl);
    assert.ok(sourceCorrection.observedOn, "source observations include their observed date");

    assert.ok(observations.some((item) => item.text.includes("latest retrieval")), "seed-source retrieval history is included");
    assert.ok(observations.some((item) => item.text.includes("verified a claim")), "lead-scoped source notes are included");
    assert.ok(!observations.some((item) => item.text.includes("another assignment")));
    assert.ok(!observations.some((item) => item.text.includes("Cross-newsroom")));
    assert.ok(!observations.some((item) => item.text.includes("not supplied for this assignment")));
    assert.ok(!observations.some((item) => item.text.includes("different lead")));
    assert.ok(observations.length <= 24, "retrieval bounds the amount of context returned");

    const secondaryLeadId = await insertLead(sql, NEWSROOM_ID, "Second story");
    const packageRequestId = await insertRequest(sql, NEWSROOM_ID, leadId);
    const primaryDraftId = await insertDraft(sql, NEWSROOM_ID, leadId, {
      civicReporting: true,
      requestId: packageRequestId,
      storyId: "story-primary",
    });
    const secondaryDraftId = await insertDraft(sql, NEWSROOM_ID, secondaryLeadId, {
      civicReporting: true,
      requestId: packageRequestId,
      storyId: "story-secondary",
    });
    const pkg = emptyReportingPackage({
      assignment: "Write two separate stories.",
      action: "Develop this lead",
      city: "Longmont",
      runStatus: "COMPLETE",
      runNote: "",
      receipt: {
        methodVersion: "2.6.0",
        methodDir: "fixture",
        mode: "full-pipeline",
        modelChoice: "auto",
        modelLabel: "sealed test fixture",
        researchToolsAvailable: false,
        elapsedMs: 0,
      },
    });
    pkg.stories = [
      {
        id: "story-primary",
        headline: "Primary story",
        draft: "Primary draft copy.",
        plainBrief: "Primary brief.",
        cannotSay: "",
        readinessTier: 2,
        claims: [],
        sources: [{ id: "S1", title: "Minutes", tier: "A", url: seedUrl, locator: "p. 1", offlineReference: "" }],
      },
      {
        id: "story-secondary",
        headline: "Secondary story",
        draft: "Secondary draft copy.",
        plainBrief: "Secondary brief.",
        cannotSay: "",
        readinessTier: 2,
        claims: [],
        sources: [{ id: "S1", title: "Minutes", tier: "A", url: seedUrl, locator: "p. 1", offlineReference: "" }],
      },
    ];
    await saveReportingPackage(sql, {
      requestId: packageRequestId,
      newsroomId: NEWSROOM_ID,
      leadId,
      draftId: primaryDraftId,
      pkg,
    });

    const primaryRead = await loadLeadReportingPackage(sql, leadId, NEWSROOM_ID);
    assert.equal(primaryRead?.requestId, packageRequestId);
    assert.equal(primaryRead?.draftId, primaryDraftId, "the existing primary-lead contract is unchanged");
    const secondaryRead = await loadLeadReportingPackage(sql, secondaryLeadId, NEWSROOM_ID);
    assert.equal(secondaryRead?.requestId, packageRequestId, "secondary story resolves its package by requestId");
    assert.equal(secondaryRead?.draftId, secondaryDraftId, "secondary story readback returns its own draft");
    assert.ok(secondaryRead?.pkg.stories.some((story) => story.id === "story-secondary"));
  });
});
