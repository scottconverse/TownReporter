import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { applyReadCadence, detectRhythm, jitterMinutes, nextDueAt, nextInterval } from "./source-cadence.ts";

/* Dynamic sources unit 4 (D169), spec 5c and 5d. */

const page = { kind: "page", tier: "C", status: "accepted", interval_minutes: 1440 };

describe("a source's read interval (spec 5c)", () => {
  it("shortens after news, down to 12 hours (6 for official or tier A)", () => {
    assert.equal(nextInterval(page, "changed", false), 1080);
    assert.equal(nextInterval({ ...page, interval_minutes: 800 }, "changed", false), 720);
    assert.equal(nextInterval({ ...page, kind: "official", interval_minutes: 500 }, "changed", false), 360);
  });
  it("grows a day after a quiet read, 6 hours if the source gave a lead this month, capped at 7 days (30 dormant)", () => {
    assert.equal(nextInterval(page, "quiet", false), 2880);
    assert.equal(nextInterval(page, "quiet", true), 1800);
    assert.equal(nextInterval({ ...page, interval_minutes: 10_000 }, "quiet", false), 10_080);
    assert.equal(nextInterval({ ...page, status: "dormant", interval_minutes: 42_000 }, "quiet", false), 43_200);
  });
});

describe("a source's posting rhythm (spec 5d)", () => {
  // Oct 2026: the 1st is a Thursday.
  const day = (d: number, m = 9) => new Date(2026, m, d, 9);
  it("finds a weekly rhythm when 70% of changes fall on one weekday", () => {
    assert.deepEqual(detectRhythm([day(1), day(8), day(15), day(22), day(6)]), { rhythm: "weekly:thu", confidence: 0.8 });
  });
  it("finds a monthly rhythm when changes fall in one week of each month", () => {
    assert.deepEqual(
      detectRhythm([day(2, 7), day(5, 8), day(3, 9), day(6, 9), day(1, 6)]),
      { rhythm: "monthly:1", confidence: 1 },
    );
  });
  it("finds none with too few changes or no pattern", () => {
    assert.equal(detectRhythm([day(1), day(8), day(15)]), null);
    assert.equal(detectRhythm([day(1), day(3), day(12), day(17), day(26)]), null);
  });
  it("puts the next read on the rhythm's day, else the interval after this read", () => {
    const readAt = new Date(2026, 9, 20, 2, 0); // Tuesday
    const j = jitterMinutes(7) * 60_000;
    assert.equal(nextDueAt(readAt, 1440, "weekly:thu", 7).getTime(), new Date(2026, 9, 22, 2, 0).getTime() + j);
    assert.equal(nextDueAt(readAt, 1440, "monthly:1", 7).getTime(), new Date(2026, 10, 2, 2, 0).getTime() + j);
    assert.equal(nextDueAt(readAt, 1440, null, 7).getTime(), readAt.getTime() + 1440 * 60_000 + j);
    assert.ok(Math.abs(jitterMinutes(7)) <= 60);
  });
});

it("a read writes the new interval and due time on the source row; a failure does not", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9551;
  await sql`insert into newsrooms(id,name) values(${room},'Cadence fixture')`;
  const [src] = await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values('cadence-user',${room},'https://city.example.test/agendas','Agendas','page','C','accepted') returning id`;
  const now = new Date(2026, 9, 20, 2, 0);
  await applyReadCadence(sql, { newsroomId: room, sourceId: src!.id, kind: "quiet", now });
  const [row] = await sql<{ interval_minutes: number; next_due_at: Date }>`select interval_minutes, next_due_at from sources where id=${src!.id}`;
  assert.equal(row!.interval_minutes, 2880);
  assert.equal(new Date(row!.next_due_at).getTime(), now.getTime() + 2880 * 60_000 + jitterMinutes(src!.id) * 60_000);
  await applyReadCadence(sql, { newsroomId: room, sourceId: src!.id, kind: "retrieval-error", now });
  const [same] = await sql<{ interval_minutes: number }>`select interval_minutes from sources where id=${src!.id}`;
  assert.equal(same!.interval_minutes, 2880);
});
