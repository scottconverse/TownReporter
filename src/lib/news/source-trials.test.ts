import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { demoteQuietSources, hasDatedLocalItem, runLightPass, trialVerdict } from "./source-trials.ts";

/* Dynamic sources unit 6 (D169), spec 5b with 10a.4/10a.5. */

const PLACE = ["Longmont", "Boulder County"];

it("knows a dated local item, and what a finished trial becomes", () => {
  assert.equal(hasDatedLocalItem("Longmont council meets Oct. 28 at 6 p.m.", PLACE), true);
  assert.equal(hasDatedLocalItem("Boulder County opens a clinic on 11/03/2026", PLACE), true);
  assert.equal(hasDatedLocalItem("Longmont news, no date here", PLACE), false);
  assert.equal(hasDatedLocalItem("Denver council meets Oct. 28", PLACE), false);
  assert.equal(trialVerdict(5, 3), null);
  assert.equal(trialVerdict(6, 2), "accepted");
  assert.equal(trialVerdict(6, 1), "dormant");
});

it("a trial is kept or dropped by itself, and a dormant source comes back when it changes", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9561;
  await sql`insert into newsrooms(id,name) values(${room},'Trial fixture')`;
  const add = async (url: string, status: string) =>
    (await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status,trial_started_at)
      values('trial-user',${room},${url},${url},'page','C',${status},now() - interval '1 day') returning id`)[0]!.id;
  const good = await add("https://good.example.test/news", "trial");
  const dull = await add("https://dull.example.test/", "trial");
  const sleepy = await add("https://sleepy.example.test/", "dormant");

  let turn = 0;
  const read = async (url: string) => {
    if (url.includes("good")) return { text: turn % 3 === 0 ? `Longmont library opens Nov. ${turn + 1}` : `Longmont library opens Nov. ${turn}` };
    if (url.includes("dull")) return { text: "Same page every time." };
    return { text: "Longmont council meets Oct. 28" };
  };
  for (turn = 0; turn < 6; turn++) {
    const ids = await runLightPass(sql, { newsroomId: room, placeNames: PLACE, read });
    assert.ok(ids.includes(good) && ids.includes(dull), `turn ${turn} read both trials`);
    // Next tick is 5 hours later.
    await sql`update sources set last_fetched_at = last_fetched_at - interval '5 hours' where newsroom_id = ${room} and status = 'trial'`;
  }
  const status = async (id: number) => (await sql<{ status: string }>`select status from sources where id=${id}`)[0]!.status;
  assert.equal(await status(good), "accepted");
  assert.equal(await status(dull), "dormant");
  // The dormant source was due its first re-check, found a dated local item, and is on trial again.
  assert.equal(await status(sleepy), "trial");
  const moves = await sql<{ source_id: number; kind: string }>`
    select source_id, kind from source_observations where newsroom_id = ${room} and kind in ('promoted','demoted') order by id`;
  assert.deepEqual(
    moves.map((m) => [m.source_id, m.kind]),
    [[sleepy, "promoted"], [good, "promoted"], [dull, "demoted"]],
  );
});

it("a quiet accepted source goes dormant after 45 days, but never an official source or an editor's pick", async () => {
  const sql = await getSql();
  const room = 9562;
  await sql`insert into newsrooms(id,name) values(${room},'Dormant fixture')`;
  const add = async (url: string, kind: string, tier: string) =>
    (await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
      values('dormant-user',${room},${url},${url},${kind},${tier},'accepted') returning id`)[0]!.id;
  const quiet = await add("https://quiet.example.test/", "page", "C");
  const official = await add("https://city.example.test/", "official", "A");
  const pick = await add("https://pick.example.test/", "page", "C");
  const lively = await add("https://lively.example.test/", "page", "C");
  for (const id of [quiet, official, pick, lively])
    await sql`insert into source_observations(newsroom_id,source_id,kind,observed_by,created_at)
      values(${room},${id},'quiet','scan',now() - interval '60 days')`;
  await sql`insert into source_observations(newsroom_id,source_id,kind,observed_by,created_at)
    values(${room},${lively},'changed','scan',now() - interval '3 days')`;
  await sql`insert into daily_scan_policies(newsroom_id,enabled,paused,local_time,runtime,source_cap,selected_source_ids,revision,configured_by_user_id)
    values(${room},true,false,'06:00','codex-terra',12,${JSON.stringify([pick])}::jsonb,1,'dormant-user')`;

  assert.deepEqual(await demoteQuietSources(sql, room), [quiet]);
  const [row] = await sql<{ status: string; dormant_reason: string }>`select status, dormant_reason from sources where id=${quiet}`;
  assert.equal(row!.status, "dormant");
  assert.match(row!.dormant_reason, /No change and no lead in 45 days/);
});
