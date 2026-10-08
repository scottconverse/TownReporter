// guards: a saved source deadline must reach the scheduled selector or the due report can be missed.
import assert from "node:assert/strict";
import { it } from "node:test";
import { getSql } from "../db.ts";
import { planDailySourceRotation } from "./daily-scan.ts";
import {
  loadSourceScanPreferences,
  persistSourceScanPreference,
} from "./source-scan-preferences.server.ts";

it("saves a source preference that the scheduled selector reads", async () => {
  const sql = await getSql();
  const newsroomId = 907301;
  const userId = "scan-preference-editor";
  const now = Date.parse("2026-10-05T12:00:00Z");
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict(id) do nothing", [
    newsroomId,
    "Preference fixture",
  ]);
  const sources = await sql.query<{ id: number }>(
    `insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
     values($1,$2,$3,'Fixture','page','A','accepted'),($1,$2,$4,'Older fixture','page','A','accepted')
     returning id`,
    [userId, newsroomId, "https://fixture.example/due", "https://fixture.example/older"],
  );
  const [due, older] = sources;
  assert.ok(due && older);
  assert.equal(
    await persistSourceScanPreference(sql, newsroomId, userId, {
      sourceId: due.id,
      purpose: "watch",
      cadence: "weekly",
      deadline: "2026-10-06",
    }),
    true,
  );
  const preferences = await loadSourceScanPreferences(sql, newsroomId);
  const plan = planDailySourceRotation({
    facts: [
      {
        id: older.id,
        url: "https://fixture.example/older",
        title: "Older",
        last_ok_at: new Date(now - 80 * 86_400_000).toISOString(),
      },
      {
        id: due.id,
        url: "https://fixture.example/due",
        title: "Due",
        last_ok_at: new Date(now - 86_400_000).toISOString(),
      },
    ],
    selectedSourceIds: [],
    everyDayCount: 0,
    preferences,
    cap: 1,
    nowMs: now,
  });
  assert.deepEqual(plan.sourceIds, [due.id]);
});
