import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPglite, getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import type { HsdsBundle } from "./hsds-types.ts";
import { importHsdsBundle } from "./hsds-import.server.ts";
import { listDeskChanges } from "./registry-desk.server.ts";
import { acceptChange, rejectChange } from "./registry-review.server.ts";

await applyMigrationsToTestPglite();

const sample = JSON.parse(
  readFileSync(new URL("./__fixtures__/sample-bundle.json", import.meta.url), "utf8"),
) as HsdsBundle;

const DIRECTORY = "example-hsds-directory";
const EDITOR = "editor-1";

function sampleCopy(): HsdsBundle {
  return structuredClone(sample);
}

/** Import the sample, then re-import with one organization renamed: one pending change. */
async function seedNameProposal(newsroomId: number, newName: string): Promise<number> {
  const sql = await getSql();
  await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  const changed = sampleCopy();
  changed.organizations[0]!.name = newName;
  await importHsdsBundle(changed, { newsroomId, directoryName: DIRECTORY });
  const rows = await sql.query<{ id: number }>(
    "select id from resource_changes where newsroom_id = $1 and review_state = 'pending'",
    [newsroomId],
  );
  assert.equal(rows.length, 1);
  return Number(rows[0]!.id);
}

async function orgName(newsroomId: number): Promise<string> {
  const sql = await getSql();
  const rows = await sql.query<{ name: string }>(
    "select name from organizations where newsroom_id = $1 and hsds_id = 'org-st-vrain-pantry'",
    [newsroomId],
  );
  return rows[0]!.name;
}

async function auditRows(newsroomId: number, subjectId: number) {
  const sql = await getSql();
  return sql.query<{ user_id: string; action: string; detail: string; subject_kind: string }>(
    `select user_id, action, detail, subject_kind from audit_events
      where newsroom_id = $1 and subject_id = $2 and action like 'registry.change.%'`,
    [newsroomId, subjectId],
  );
}

test("accepting with apply changes the one value and leaves last_verified_* alone", async () => {
  const sql = await getSql();
  const room = 9301;
  const id = await seedNameProposal(room, "St. Vrain Community Food Pantry");
  // A legacy stamp on the organization and on a service, set before the review.
  await sql.query(
    `update organizations set last_verified_at = '2026-01-02T03:04:05Z', last_verified_by = 'legacy', verification_method = 'editor'
      where newsroom_id = $1`,
    [room],
  );
  const before = await sql.query<Record<string, unknown>>(
    "select last_verified_at, last_verified_by, verification_method from organizations where newsroom_id = $1 and hsds_id = 'org-st-vrain-pantry'",
    [room],
  );

  const result = await acceptChange(room, EDITOR, { changeId: id, apply: true, note: "Checked by phone" });
  assert.deepEqual(result.ok, true);

  assert.equal(await orgName(room), "St. Vrain Community Food Pantry");
  const after = await sql.query<Record<string, unknown>>(
    "select last_verified_at, last_verified_by, verification_method from organizations where newsroom_id = $1 and hsds_id = 'org-st-vrain-pantry'",
    [room],
  );
  assert.deepEqual(after, before);

  const change = await sql.query<Record<string, unknown>>(
    "select review_state, reviewed_by, reviewed_at, applied_at, review_note from resource_changes where id = $1",
    [id],
  );
  assert.equal(change[0]!.review_state, "accepted");
  assert.equal(change[0]!.reviewed_by, EDITOR);
  assert.ok(change[0]!.reviewed_at);
  assert.ok(change[0]!.applied_at);
  assert.equal(change[0]!.review_note, "Checked by phone");

  const audit = await auditRows(room, id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.user_id, EDITOR);
  assert.equal(audit[0]!.action, "registry.change.accept");
  assert.equal(audit[0]!.subject_kind, "registry-change");
});

test("rejecting leaves the value, records who and why, and writes one audit row", async () => {
  const sql = await getSql();
  const room = 9302;
  const id = await seedNameProposal(room, "Some Other Name");
  const result = await rejectChange(room, EDITOR, { changeId: id, note: "Not what the page says" });
  assert.equal(result.ok, true);
  assert.equal(await orgName(room), "St. Vrain Community Pantry");
  const change = await sql.query<Record<string, unknown>>(
    "select review_state, reviewed_by, applied_at, review_note from resource_changes where id = $1",
    [id],
  );
  assert.equal(change[0]!.review_state, "rejected");
  assert.equal(change[0]!.reviewed_by, EDITOR);
  assert.equal(change[0]!.applied_at, null);
  assert.equal(change[0]!.review_note, "Not what the page says");
  const audit = await auditRows(room, id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.action, "registry.change.reject");
  assert.equal(audit[0]!.user_id, EDITOR);
});

test("repeating an accept or a reject changes nothing and writes no second audit row", async () => {
  const room = 9303;
  const id = await seedNameProposal(room, "Repeat Name");
  assert.equal((await acceptChange(room, EDITOR, { changeId: id, apply: true })).ok, true);
  const again = await acceptChange(room, "someone-else", { changeId: id, apply: true });
  assert.equal(again.ok, false);
  if (!again.ok) {
    assert.equal(again.reason, "resolved");
    assert.match(again.message, /already accepted by editor-1 on \d{4}-\d{2}-\d{2}\. Nothing was changed\./);
  }
  const rejectAfter = await rejectChange(room, "someone-else", { changeId: id });
  assert.equal(rejectAfter.ok, false);
  assert.equal((await auditRows(room, id)).length, 1);

  const room2 = 9304;
  const id2 = await seedNameProposal(room2, "Repeat Reject");
  assert.equal((await rejectChange(room2, EDITOR, { changeId: id2 })).ok, true);
  const again2 = await rejectChange(room2, EDITOR, { changeId: id2 });
  assert.equal(again2.ok, false);
  if (!again2.ok) assert.equal(again2.reason, "resolved");
  const acceptRejected = await acceptChange(room2, EDITOR, { changeId: id2, apply: true });
  assert.equal(acceptRejected.ok, false);
  assert.equal(await orgName(room2), "St. Vrain Community Pantry");
  assert.equal((await auditRows(room2, id2)).length, 1);
});

test("a proposal made against an older value is refused as stale and nothing changes", async () => {
  const sql = await getSql();
  const room = 9305;
  const id = await seedNameProposal(room, "Proposed Name");
  await sql.query(
    "update organizations set name = 'Edited By Hand' where newsroom_id = $1 and hsds_id = 'org-st-vrain-pantry'",
    [room],
  );
  const result = await acceptChange(room, EDITOR, { changeId: id, apply: true });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "stale");
    assert.match(result.message, /Edited By Hand/);
    assert.match(result.message, /Proposed Name/);
  }
  assert.equal(await orgName(room), "Edited By Hand");
  const change = await sql.query<{ review_state: string }>(
    "select review_state from resource_changes where id = $1",
    [id],
  );
  assert.equal(change[0]!.review_state, "pending");
  assert.equal((await auditRows(room, id)).length, 0);
  // The editor can still accept it without applying.
  const without = await acceptChange(room, EDITOR, { changeId: id, apply: false });
  assert.equal(without.ok, true);
  assert.equal(await orgName(room), "Edited By Hand");
});

test("a proposal with no target, a removed target, or a field it cannot change is refused", async () => {
  const sql = await getSql();
  const room = 9306;
  await importHsdsBundle(sampleCopy(), { newsroomId: room, directoryName: DIRECTORY });
  const evidence = await sql.query<{ id: number }>(
    "select id from snapshots where newsroom_id = $1 limit 1",
    [room],
  );
  const snapshotId = Number(evidence[0]!.id);
  const contact = await sql.query<{ id: number; name: string }>(
    "select id, name from contacts where newsroom_id = $1 order by id limit 1",
    [room],
  );
  const org = await sql.query<{ id: number }>(
    "select id from organizations where newsroom_id = $1 and hsds_id = 'org-st-vrain-pantry'",
    [room],
  );

  async function propose(entityType: string, entityId: number | null, field: string, before: string | null) {
    const rows = await sql.query<{ id: number }>(
      `insert into resource_changes
         (newsroom_id, evidence_capture_id, evidence_tier, entity_type, entity_id, field_name,
          before_value, after_value, change_kind, review_state)
       values ($1, $2, 'B', $3, $4, $5, $6, 'x', 'field_change', 'pending') returning id`,
      [room, snapshotId, entityType, entityId, field, before],
    );
    return Number(rows[0]!.id);
  }

  const noId = await propose("organization", null, "name", null);
  const noRow = await propose("organization", 99999999, "name", null);
  const noField = await propose("organization", Number(org[0]!.id), "hsds_id", "org-st-vrain-pantry");
  const pointer = await propose("service", 1, "organization_id", "1");
  await sql.query("update contacts set removed_at = now(), removed_by = 'e' where id = $1", [contact[0]!.id]);
  const removed = await propose("contact", Number(contact[0]!.id), "name", contact[0]!.name);

  const expected: [number, string][] = [
    [noId, "no-target"],
    [noRow, "no-target"],
    [removed, "no-target"],
    [noField, "not-applicable"],
    [pointer, "not-applicable"],
  ];
  for (const [id, reason] of expected) {
    const result = await acceptChange(room, EDITOR, { changeId: id, apply: true });
    assert.equal(result.ok, false, `change ${id}`);
    if (!result.ok) {
      assert.equal(result.reason, reason, `change ${id}`);
      assert.match(result.message, /Reject it, or accept it without applying/);
    }
    const state = await sql.query<{ review_state: string }>(
      "select review_state from resource_changes where id = $1",
      [id],
    );
    assert.equal(state[0]!.review_state, "pending");
  }
  // Without applying, each can be accepted and nothing else changes.
  const accepted = await acceptChange(room, EDITOR, { changeId: noId, apply: false });
  assert.equal(accepted.ok, true);
  const row = await sql.query<{ applied_at: unknown; review_state: string }>(
    "select applied_at, review_state from resource_changes where id = $1",
    [noId],
  );
  assert.equal(row[0]!.review_state, "accepted");
  assert.equal(row[0]!.applied_at, null);
});

test("a proposal in another newsroom is refused", async () => {
  const id = await seedNameProposal(9307, "Other Room Name");
  const accept = await acceptChange(9308, EDITOR, { changeId: id, apply: true });
  const reject = await rejectChange(9308, EDITOR, { changeId: id });
  for (const result of [accept, reject]) {
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, "That proposal is not in this newsroom. Nothing was changed.");
    }
  }
  assert.equal(await orgName(9307), "St. Vrain Community Pantry");
  assert.equal((await auditRows(9307, id)).length, 0);
});

test("a note that is too long or holds control characters is refused", async () => {
  const sql = await getSql();
  const room = 9309;
  const id = await seedNameProposal(room, "Note Name");
  const tooLong = await rejectChange(room, EDITOR, { changeId: id, note: "x".repeat(1001) });
  const control = await acceptChange(room, EDITOR, { changeId: id, apply: true, note: "a\u0000b" });
  assert.equal(tooLong.ok, false);
  assert.equal(control.ok, false);
  assert.equal(await orgName(room), "St. Vrain Community Pantry");
  const state = await sql.query<{ review_state: string }>(
    "select review_state from resource_changes where id = $1",
    [id],
  );
  assert.equal(state[0]!.review_state, "pending");
});

test("the desk list carries the review fields and the current value of the target", async () => {
  const sql = await getSql();
  const room = 9310;
  const id = await seedNameProposal(room, "Listed Name");
  await sql.query(
    "update organizations set name = 'Edited Since' where newsroom_id = $1 and hsds_id = 'org-st-vrain-pantry'",
    [room],
  );
  let list = await listDeskChanges(sql, room);
  let entry = list.find((item) => item.id === id)!;
  assert.equal(entry.currentValue, "Edited Since");
  assert.equal(entry.targetLive, true);
  assert.equal(entry.reviewedBy, null);
  assert.equal(entry.appliedAt, null);
  await rejectChange(room, EDITOR, { changeId: id, note: "no" });
  list = await listDeskChanges(sql, room);
  entry = list.find((item) => item.id === id)!;
  assert.equal(entry.reviewedBy, EDITOR);
  assert.ok(entry.reviewedAt);
  assert.equal(entry.reviewNote, "no");
});

test("a rejected proposal is not proposed again on re-import, and the counts stay right", async () => {
  const sql = await getSql();
  const room = 9311;
  const id = await seedNameProposal(room, "Rejected Name");
  await rejectChange(room, EDITOR, { changeId: id });
  const changed = sampleCopy();
  changed.organizations[0]!.name = "Rejected Name";
  const again = await importHsdsBundle(changed, { newsroomId: room, directoryName: DIRECTORY });
  assert.deepEqual(again.conflicts, []);
  assert.equal(again.tables.organizations.changed, 0);
  assert.equal(again.tables.organizations.alreadyPending, 1);
  const all = await sql.query<{ count: string }>(
    "select count(*)::text as count from resource_changes where newsroom_id = $1",
    [room],
  );
  assert.equal(Number(all[0]!.count), 1);

  // A different proposed value is a new proposal.
  const other = sampleCopy();
  other.organizations[0]!.name = "A Third Name";
  const third = await importHsdsBundle(other, { newsroomId: room, directoryName: DIRECTORY });
  assert.equal(third.conflicts.length, 1);
});

// This checks the outcome only, not the lock. PGlite has one connection, so the
// two imports below run one after the other and never contend for the advisory
// lock. A pass here does not show the lock works.
test("two imports of one directory at once leave one proposal (checks the outcome, not the lock)", async () => {
  const sql = await getSql();
  const room = 9312;
  await importHsdsBundle(sampleCopy(), { newsroomId: room, directoryName: DIRECTORY });
  const changed = sampleCopy();
  changed.organizations[0]!.name = "Raced Name";
  await Promise.all([
    importHsdsBundle(changed, { newsroomId: room, directoryName: DIRECTORY }),
    importHsdsBundle(changed, { newsroomId: room, directoryName: DIRECTORY }),
  ]);
  const rows = await sql.query<{ count: string }>(
    "select count(*)::text as count from resource_changes where newsroom_id = $1",
    [room],
  );
  assert.equal(Number(rows[0]!.count), 1);
});

test("legacy last_verified_* values on a service survive migration 0166", async () => {
  const sql = await getSql();
  const room = 9313;
  await importHsdsBundle(sampleCopy(), { newsroomId: room, directoryName: DIRECTORY });
  await sql.query(
    `update services set last_verified_at = '2026-02-03T04:05:06Z', last_verified_by = 'legacy-editor',
            verification_method = 'editor' where newsroom_id = $1`,
    [room],
  );
  const before = await sql.query<Record<string, unknown>>(
    "select id, last_verified_at, last_verified_by, verification_method from services where newsroom_id = $1 order by id",
    [room],
  );
  // Apply 0166 again against the seeded row: it is idempotent and additive.
  const migration = readFileSync(new URL("../../../../migrations/0166_resource_review_verification.sql", import.meta.url), "utf8");
  await (await getPglite()).exec(migration.replace("set local lock_timeout = '3s';", ""));
  const after = await sql.query<Record<string, unknown>>(
    "select id, last_verified_at, last_verified_by, verification_method from services where newsroom_id = $1 order by id",
    [room],
  );
  assert.deepEqual(after, before);
  const table = await sql.query<{ count: string }>("select count(*)::text as count from resource_verifications", []);
  assert.equal(Number(table[0]!.count), 0);
});

test("a rejected proposal is made again once the entry has changed under it", async () => {
  const sql = await getSql();
  const room = 9314;
  const id = await seedNameProposal(room, "Rejected Then Edited");
  assert.equal((await rejectChange(room, EDITOR, { changeId: id })).ok, true);
  // The entry now says something else, so the old "X -> Y" no longer describes it.
  await sql.query(
    "update organizations set name = 'Edited After Rejection' where newsroom_id = $1 and hsds_id = 'org-st-vrain-pantry'",
    [room],
  );
  const again = sampleCopy();
  again.organizations[0]!.name = "Rejected Then Edited";
  const result = await importHsdsBundle(again, { newsroomId: room, directoryName: DIRECTORY });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]!.before_value, "Edited After Rejection");
  assert.equal(result.conflicts[0]!.after_value, "Rejected Then Edited");
  assert.equal(result.tables.organizations.changed, 1);
  const pending = await sql.query<{ before_value: string; after_value: string }>(
    "select before_value, after_value from resource_changes where newsroom_id = $1 and review_state = 'pending' order by id",
    [room],
  );
  assert.deepEqual(pending, [{ before_value: "Edited After Rejection", after_value: "Rejected Then Edited" }]);
});

test("a proposal accepted without applying is not proposed again on re-import", async () => {
  const sql = await getSql();
  const room = 9315;
  const id = await seedNameProposal(room, "Accepted Unapplied");
  assert.equal((await acceptChange(room, EDITOR, { changeId: id, apply: false })).ok, true);
  assert.equal(await orgName(room), "St. Vrain Community Pantry");
  const again = sampleCopy();
  again.organizations[0]!.name = "Accepted Unapplied";
  const result = await importHsdsBundle(again, { newsroomId: room, directoryName: DIRECTORY });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.tables.organizations.alreadyPending, 1);
  assert.equal(result.tables.organizations.changed, 0);
  const all = await sql.query<{ count: string }>(
    "select count(*)::text as count from resource_changes where newsroom_id = $1",
    [room],
  );
  assert.equal(Number(all[0]!.count), 1);
});

test("a proposal accepted with apply is not proposed again once the entry is back to the old value", async () => {
  const sql = await getSql();
  const room = 9316;
  const id = await seedNameProposal(room, "Accepted Applied");
  assert.equal((await acceptChange(room, EDITOR, { changeId: id, apply: true })).ok, true);
  assert.equal(await orgName(room), "Accepted Applied");
  await sql.query(
    "update organizations set name = 'St. Vrain Community Pantry' where newsroom_id = $1 and hsds_id = 'org-st-vrain-pantry'",
    [room],
  );
  const again = sampleCopy();
  again.organizations[0]!.name = "Accepted Applied";
  const result = await importHsdsBundle(again, { newsroomId: room, directoryName: DIRECTORY });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.tables.organizations.alreadyPending, 1);
  const all = await sql.query<{ count: string }>(
    "select count(*)::text as count from resource_changes where newsroom_id = $1",
    [room],
  );
  assert.equal(Number(all[0]!.count), 1);
});

test("a value the field cannot hold is not-applicable, and the proposal, the entry and the audit stay as they were", async () => {
  const sql = await getSql();
  const room = 9317;
  await importHsdsBundle(sampleCopy(), { newsroomId: room, directoryName: DIRECTORY });
  const snapshot = await sql.query<{ id: number }>("select id from snapshots where newsroom_id = $1 limit 1", [room]);
  const service = await sql.query<{ id: number }>("select id from services where newsroom_id = $1 order by id limit 1", [room]);
  const schedule = await sql.query<{ id: number }>("select id from schedules where newsroom_id = $1 order by id limit 1", [room]);
  const location = await sql.query<{ id: number }>("select id from locations where newsroom_id = $1 order by id limit 1", [room]);
  // Known starting values, so each proposal is made against the value the row holds.
  await sql.query("update services set status = 'active' where id = $1", [service[0]!.id]);
  await sql.query("update schedules set by_appointment = false where id = $1", [schedule[0]!.id]);
  await sql.query("update locations set latitude = null where id = $1", [location[0]!.id]);

  const cases = [
    // A check constraint: the status list does not allow "retired" (SQLSTATE 23514).
    { entityType: "service", entityId: service[0]!.id, field: "status", table: "services", column: "status", before: "active", after: "retired", stored: "active" },
    // A boolean that is not true or false (SQLSTATE 22P02).
    { entityType: "schedule", entityId: schedule[0]!.id, field: "by_appointment", table: "schedules", column: "by_appointment", before: "false", after: "maybe", stored: false },
    // A number that is not a number (SQLSTATE 22P02).
    { entityType: "location", entityId: location[0]!.id, field: "latitude", table: "locations", column: "latitude", before: null, after: "north", stored: null },
  ];
  for (const c of cases) {
    const inserted = await sql.query<{ id: number }>(
      `insert into resource_changes
         (newsroom_id, evidence_capture_id, evidence_tier, entity_type, entity_id, field_name,
          before_value, after_value, change_kind, review_state)
       values ($1, $2, 'B', $3, $4, $5, $6, $7, 'field_change', 'pending') returning id`,
      [room, snapshot[0]!.id, c.entityType, c.entityId, c.field, c.before, c.after],
    );
    const changeId = Number(inserted[0]!.id);
    const result = await acceptChange(room, EDITOR, { changeId, apply: true });
    assert.equal(result.ok, false, c.field);
    if (!result.ok) assert.equal(result.reason, "not-applicable", c.field);
    const state = await sql.query<{ review_state: string }>(
      "select review_state from resource_changes where id = $1",
      [changeId],
    );
    assert.equal(state[0]!.review_state, "pending", c.field);
    const value = await sql.query<{ value: unknown }>(
      `select ${c.column} as value from ${c.table} where id = $1`,
      [c.entityId],
    );
    assert.deepEqual(value[0]!.value, c.stored, c.field);
    assert.equal((await auditRows(room, changeId)).length, 0, c.field);
  }
});

test("an error that is not a value refusal is rethrown, and the proposal, the entry and the audit stay as they were", async () => {
  const sql = await getSql();
  const room = 9318;
  const id = await seedNameProposal(room, "Trigger Name");
  // Fails the update with SQLSTATE P0001, which is neither class 22 nor class 23.
  await sql.query(
    `create or replace function registry_test_refuse_room() returns trigger language plpgsql as $$
     begin
       if new.newsroom_id = 9318 then
         raise exception 'test refusal' using errcode = 'P0001';
       end if;
       return new;
     end $$`,
  );
  await sql.query(
    "create trigger registry_test_refuse_room before update on organizations for each row execute function registry_test_refuse_room()",
  );
  await assert.rejects(() => acceptChange(room, EDITOR, { changeId: id, apply: true }), /test refusal/);
  assert.equal(await orgName(room), "St. Vrain Community Pantry");
  const state = await sql.query<{ review_state: string }>(
    "select review_state from resource_changes where id = $1",
    [id],
  );
  assert.equal(state[0]!.review_state, "pending");
  assert.equal((await auditRows(room, id)).length, 0);
});

test("a needs-editor proposal can be accepted with apply and rejected", async () => {
  const sql = await getSql();
  const room = 9319;
  await importHsdsBundle(sampleCopy(), { newsroomId: room, directoryName: DIRECTORY });
  const snapshot = await sql.query<{ id: number }>("select id from snapshots where newsroom_id = $1 limit 1", [room]);
  const org = await sql.query<{ id: number }>(
    "select id from organizations where newsroom_id = $1 and hsds_id = 'org-st-vrain-pantry'",
    [room],
  );
  const service = await sql.query<{ id: number; name: string }>(
    "select id, name from services where newsroom_id = $1 order by id limit 1",
    [room],
  );
  async function needsEditor(field: string, entityType: string, entityId: number, before: string, after: string) {
    const rows = await sql.query<{ id: number }>(
      `insert into resource_changes
         (newsroom_id, evidence_capture_id, evidence_tier, entity_type, entity_id, field_name,
          before_value, after_value, change_kind, review_state)
       values ($1, $2, 'B', $3, $4, $5, $6, $7, 'field_change', 'needs-editor') returning id`,
      [room, snapshot[0]!.id, entityType, entityId, field, before, after],
    );
    return Number(rows[0]!.id);
  }
  const toAccept = await needsEditor("name", "organization", Number(org[0]!.id), "St. Vrain Community Pantry", "Crisis Name");
  const toReject = await needsEditor("name", "service", service[0]!.id, service[0]!.name, "Crisis Service Name");

  const accepted = await acceptChange(room, EDITOR, { changeId: toAccept, apply: true });
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.applied, true);
  assert.equal(await orgName(room), "Crisis Name");
  const acceptedState = await sql.query<{ review_state: string; applied_at: unknown }>(
    "select review_state, applied_at from resource_changes where id = $1",
    [toAccept],
  );
  assert.equal(acceptedState[0]!.review_state, "accepted");
  assert.ok(acceptedState[0]!.applied_at);

  const rejected = await rejectChange(room, EDITOR, { changeId: toReject, note: "Not a crisis" });
  assert.equal(rejected.ok, true);
  const rejectedState = await sql.query<{ review_state: string }>(
    "select review_state from resource_changes where id = $1",
    [toReject],
  );
  assert.equal(rejectedState[0]!.review_state, "rejected");
});
