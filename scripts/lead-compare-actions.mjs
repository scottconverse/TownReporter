#!/usr/bin/env node
import assert from "node:assert/strict";

async function waitForLead(pool, id, predicate, message) {
  const deadline = Date.now() + 20_000;
  let latest;
  while (Date.now() < deadline) {
    const result = await pool.query(
      "select id, status, possible_duplicate_of, kill_reason from leads where id = $1",
      [id],
    );
    latest = result.rows[0];
    if (latest && predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${message}; last database row: ${JSON.stringify(latest ?? null)}`);
}

async function seedPair(pool, { userId, newsroomId, stamp, prefix, status }) {
  const priorHeadline = `TEST FIXTURE — ${prefix} prior story ${stamp}`;
  const currentHeadline = `TEST FIXTURE — ${prefix} current story ${stamp}`;
  const prior = await pool.query(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,newsworthiness)
     values($1,$2,$3,'The earlier public record is attached.','council','new','[]',8)
     returning id`,
    [userId, newsroomId, priorHeadline],
  );
  const priorId = prior.rows[0].id;
  const current = await pool.query(
    `insert into leads(
       user_id,newsroom_id,headline,why,topic,status,source_urls,newsworthiness,
       possible_duplicate_of,dup_kind,killed_at,kill_reason
     ) values($1,$2,$3,'The current record needs duplicate review.','council',$4,'[]',8,$5,'possible',$6,$7)
     returning id`,
    [
      userId,
      newsroomId,
      currentHeadline,
      status,
      priorId,
      status === "killed" ? new Date().toISOString() : null,
      status === "killed" ? "No longer active" : null,
    ],
  );
  const currentId = current.rows[0].id;
  await pool.query(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls)
     values($1,$2,$3,$4,'Saved for the warning path.','TEST FIXTURE saved draft prose.','council','[]')`,
    [userId, newsroomId, currentId, currentHeadline],
  );
  return { priorId, priorHeadline, currentId, currentHeadline };
}

/** Run against the same isolated browser desk and PostgreSQL used by the corrections walk. */
export async function verifyLeadCompareActions({ page, pool, base, userId, newsroomId, stamp, step }) {
  const killPair = await seedPair(pool, {
    userId,
    newsroomId,
    stamp,
    prefix: "Compare kill",
    status: "new",
  });

  await page.goto(`${base}/desk/story/${killPair.currentId}`, {
    waitUntil: "networkidle",
  });
  const killPress = page.getByRole("button", { name: /Same story.*kill this one/i });
  await killPress.waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await killPress.click();
  const killAnyway = page.getByRole("button", { name: "Kill anyway", exact: true });
  await killAnyway.waitFor();
  const beforeKillOverride = await pool.query(
    "select status, possible_duplicate_of from leads where id = $1",
    [killPair.currentId],
  );
  assert.equal(beforeKillOverride.rows[0]?.status, "new", "the warning press must not kill yet");
  assert.equal(
    Number(beforeKillOverride.rows[0]?.possible_duplicate_of),
    Number(killPair.priorId),
    "the warning press keeps the duplicate link until the explicit override",
  );

  await killAnyway.click();
  const killed = await waitForLead(
    pool,
    killPair.currentId,
    (row) => row.status === "killed" && row.kill_reason?.includes(killPair.priorHeadline),
    "Compare Kill anyway did not kill with the duplicate reason",
  );
  assert.ok(killed.kill_reason.includes(killPair.priorHeadline));
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.waitFor();
  await undo.click();
  await waitForLead(
    pool,
    killPair.currentId,
    (row) => row.status === "new",
    "Compare kill Undo did not restore the lead",
  );
  step("Compare Same story warns, Kill anyway records the duplicate reason, and Undo restores New");

  const movePair = await seedPair(pool, {
    userId,
    newsroomId,
    stamp,
    prefix: "Compare move to New",
    status: "killed",
  });
  await page.goto(`${base}/desk/story/${movePair.currentId}`, {
    waitUntil: "networkidle",
  });
  const movePress = page.getByRole("button", { name: /Not a duplicate.*move to New/i });
  await movePress.waitFor();
  await movePress.click();
  const moveAnyway = page.getByRole("button", { name: "Move to New anyway", exact: true });
  await moveAnyway.waitFor();
  const beforeMoveOverride = await pool.query(
    "select status, possible_duplicate_of from leads where id = $1",
    [movePair.currentId],
  );
  assert.equal(beforeMoveOverride.rows[0]?.status, "killed", "the warning press must leave Killed unchanged");
  assert.equal(
    Number(beforeMoveOverride.rows[0]?.possible_duplicate_of),
    Number(movePair.priorId),
    "the warning press keeps the duplicate link until the explicit override",
  );

  await moveAnyway.click();
  const moved = await waitForLead(
    pool,
    movePair.currentId,
    (row) => row.status === "new" && row.possible_duplicate_of === null,
    "Move to New anyway did not clear the link and set New",
  );
  assert.equal(moved.status, "new");
  assert.equal(moved.possible_duplicate_of, null);
  step("Not a duplicate warns, Move to New anyway clears the link and puts the killed lead in New");
}
