// guards: the editor could receive unpinned reporting claims or a pin to a newer passage that does not support the draft.
import assert from "node:assert/strict";
import { it } from "node:test";
import { getSql } from "../db.ts";
import { retainReportingEvidence, reportingStoryReviewClaims } from "./reporting-evidence-adapter.ts";
import type { PackageStory } from "./civic-reporting.ts";

it("retains a draft's own source and pins the capture containing its quote", async () => {
  const sql = await getSql(), room = 89915, url = "https://example.org/record";
  const quote = "The council approved the repairs.";
  await retainReportingEvidence(sql, { newsroomId: room, userId: "pin-editor" }, [{ url, title: "Minutes", text: quote, ok: true }]);
  const [retained] = await sql.query<{ id: number }>("select id from artifact_versions where newsroom_id=$1 and url=$2", [room, url]);
  assert.ok(retained, "the evidence must be retained before judgment");
  await sql.query("insert into artifact_versions(user_id,newsroom_id,url,title,full_text,content_hash,captured_at) values('pin-editor',$1,$2,'Later','The repairs were postponed.','later',now()+interval '1 minute')", [room, url]);
  const story = { id: "repairs", sources: [{ id: "minutes", url, title: "Minutes", tier: "A", locator: "record", offlineReference: "" }],
    claims: [{ id: "repairs", text: quote, status: "VERIFIED", sourceIds: ["minutes"], nextCheck: "",
      recordEvidence: { kind: "document", quote, url, locator: "record" } }] } as PackageStory;
  const review = await reportingStoryReviewClaims(sql, room, story);
  assert.equal(review.rows[0].reporting?.references[0].versionId, retained.id);
});
