import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getSql } from "../db.ts";
import { catchUpVotesFromMinutes } from "./meeting-minutes.server.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import type { PrimeGovMeeting } from "./primegov.ts";

/*
  D214's amendment: meetings captured before the minutes reader existed learn
  their votes in hindsight. The Oct 6, 2026 Longmont council meeting is the real
  case -- its votes are in the Oct 20 packet's minutes, and its rows were
  captured "not established".

  The later packet is the fixture; nothing here reaches a network. Each test
  uses its own newsroom id because the six-hour guard is per newsroom and
  outlives a single test.
*/

await applyMigrationsToTestPglite();

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/minutes/longmont-council-2026-10-06-minutes.txt"),
  "utf8",
);

const VIDEO = "cg-votes-oct6";

const OCT6: PrimeGovMeeting = {
  id: 3001,
  title: "City Council Regular Session",
  date: "2026-10-06",
  dateTime: "2026-10-06T19:00:00",
  time: "19:00",
  location: "City Council Chambers",
  documentList: [],
};

const OCT20: PrimeGovMeeting = {
  id: 3716,
  title: "City Council Regular Session",
  date: "2026-10-20",
  dateTime: "2026-10-20T19:00:00",
  time: "19:00",
  location: "City Council Chambers",
  documentList: [
    { id: 1, templateId: 16844, compileOutputType: 1, templateName: "Packet", link: null },
  ],
};

const NOW = Date.parse("2026-10-21T22:00:00Z");

async function seed(newsroomId: number): Promise<void> {
  const sql = await getSql();
  await sql.query("delete from meeting_structured_votes where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from meeting_capture_records where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from sources where newsroom_id=$1", [newsroomId]);
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [
    newsroomId,
    `Minutes room ${newsroomId}`,
  ]);
  await sql.query(
    "insert into sources(newsroom_id,user_id,url,title,kind,tier,status) values($1,'owner',$2,'Portal','official','A','accepted')",
    [newsroomId, "https://city.primegov.com/public/portal"],
  );
  await sql.query(
    `insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status)
     values($1,$2,'https://youtube.com/@city','City Council Regular Session October 6, 2026','2026-10-07','captured')`,
    [newsroomId, VIDEO],
  );
  for (const item of ["4A", "13"]) {
    await sql.query(
      `insert into meeting_structured_votes(newsroom_id,video_id,item,established,result,provenance,disagreements)
       values($1,$2,$3,false,'not established',$4,'[]')`,
      [
        newsroomId,
        VIDEO,
        item,
        JSON.stringify([{ source: "transcript", locator: "segment 12: the clerk read item 4A" }]),
      ],
    );
  }
}

function deps() {
  const downloads: string[] = [];
  return {
    downloads,
    now: () => NOW,
    findMeeting: async () => ({ meeting: OCT6, urls: [] }),
    portalMeetings: async () => [OCT6, OCT20],
    documentText: async (url: URL) => {
      downloads.push(url.toString());
      return FIXTURE;
    },
  };
}

async function voteRow(newsroomId: number, item: string) {
  const sql = await getSql();
  const rows = await sql.query<{
    established: boolean; motion: string | null; mover: string | null; seconder: string | null;
    tally: string | null; result: string; source: string | null; provenance: string; disagreements: string;
  }>(
    "select established,motion,mover,seconder,tally,result,source,provenance,disagreements from meeting_structured_votes where newsroom_id=$1 and video_id=$2 and item=$3",
    [newsroomId, VIDEO, item],
  );
  const row = rows[0];
  if (!row) throw new Error(`no row for item ${item}`);
  return {
    ...row,
    provenance: JSON.parse(row.provenance) as { source: string; locator: string | null; excerpt?: string }[],
    disagreements: JSON.parse(row.disagreements) as string[],
  };
}

test("catch-up establishes the item the minutes voted and leaves the rest alone", async () => {
  const newsroomId = 846_001;
  await seed(newsroomId);
  const sql = await getSql();
  const read = deps();
  const run = await catchUpVotesFromMinutes(sql, newsroomId, read);

  assert.equal(run.meetings.length, 1, "one meeting was caught up");
  assert.equal(run.meetings[0]!.videoId, VIDEO);
  assert.equal(run.meetings[0]!.established, 1, "one of the two rows was established");
  assert.equal(run.meetings[0]!.unestablished, 2);

  const established = await voteRow(newsroomId, "4A");
  assert.equal(established.established, true);
  assert.equal(established.source, "minutes");
  assert.equal(established.mover, "Sean McCoy");
  assert.equal(established.seconder, "Diane Crist");
  assert.equal(established.tally, "7-0");
  assert.equal(established.result, "Passed");
  assert.match(established.motion ?? "", /approve the September 22, 2026 – Regular Session minutes as presented/);
  assert.equal(established.provenance[0]!.source, "minutes");
  assert.match(established.provenance[0]!.locator ?? "", /#page=\d+$/, "the locator names the page the section starts on");
  assert.match(established.provenance[0]!.excerpt ?? "", /MOTION Sean McCoy moved, seconded by Diane Crist/);
  assert.equal(
    established.provenance.some((entry) => entry.source === "transcript"),
    true,
    "the row's transcript entry is kept beside the minutes entry",
  );

  const untouched = await voteRow(newsroomId, "13");
  assert.equal(untouched.established, false, "an item the minutes did not vote stays unestablished");
  assert.equal(untouched.source, null);

  assert.equal(read.downloads.length, 1, "only the later meeting's packet was read");
  assert.match(read.downloads[0]!, /meetingTemplateId=16844/, "the packet of the next meeting of the same body");
});

test("a second run inside six hours does nothing", async () => {
  const newsroomId = 846_011;
  await seed(newsroomId);
  const sql = await getSql();
  const read = deps();
  await catchUpVotesFromMinutes(sql, newsroomId, read);
  const afterFirst = read.downloads.length;

  // A row this newsroom has not caught up yet. If the guard failed, this run
  // would read the packet again; it must not.
  await sql.query(
    `insert into meeting_structured_votes(newsroom_id,video_id,item,established,result)
     values($1,$2,'17',false,'not established')`,
    [newsroomId, VIDEO],
  );

  const second = await catchUpVotesFromMinutes(sql, newsroomId, read);
  assert.deepEqual(second.meetings, [], "the six-hour guard skips the newsroom");
  assert.equal(read.downloads.length, afterFirst, "and reads nothing");
  assert.equal((await voteRow(newsroomId, "17")).established, false);
});

test("a newsroom with no unestablished vote rows reads nothing", async () => {
  const newsroomId = 846_021;
  await seed(newsroomId);
  const sql = await getSql();
  await sql.query("delete from meeting_structured_votes where newsroom_id=$1", [newsroomId]);
  const read = deps();
  const run = await catchUpVotesFromMinutes(sql, newsroomId, read);
  assert.deepEqual(run.meetings, []);
  assert.equal(read.downloads.length, 0, "no meetings means no download at all");
});

test("reports the reason when the minutes cannot be found", async () => {
  const newsroomId = 846_031;
  await seed(newsroomId);
  const sql = await getSql();
  const read = { ...deps(), documentText: async () => null };
  const run = await catchUpVotesFromMinutes(sql, newsroomId, read);
  assert.equal(run.meetings.length, 1);
  assert.equal(run.meetings[0]!.established, 0);
  assert.match(run.meetings[0]!.reason, /no minutes/i);
  assert.equal((await voteRow(newsroomId, "4A")).established, false);
});
