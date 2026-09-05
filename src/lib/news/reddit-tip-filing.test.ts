import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureDarkSchema, fileRedditTipFor } from "./dark.ts";
import { classifyRedditPosts, type RedditPost } from "./reddit.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";

/**
 * Owner report 2026-09-05: "Check r/longmont" ran ~60s with no visible
 * progress and then a one-line result an editor could miss. The fix adds a
 * result panel that lists every scored post, including near misses, with a
 * "File as tip" action for anything the sweep did not already file.
 *
 * fileRedditTipFor is that action's server half -- extracted as a plain
 * function (the queueInvestigationFor pattern this file already uses) so it
 * is testable against PGLite without a request context.
 */
describe("fileRedditTipFor (Check r/longmont: File as tip)", () => {
  it("files a post as an anomaly and reports filed: true", async () => {
    await ensureDarkSchema();
    const user = `reddit-tip-${Date.now()}`;
    const url = `https://www.reddit.com/r/longmont/comments/${Date.now()}/manual/`;
    const res = await fileRedditTipFor(user, DEFAULT_NEWSROOM_ID, {
      url,
      title: "City council votes on the budget shortfall",
      excerpt: "The packet shows a $2.1M shortfall.",
    });
    assert.deepEqual(res, { ok: true, filed: true });

    const sql = await getSql();
    const rows = await sql<{ kind: string; url: string; details: string }>`
      select kind, url, details from anomalies where url = ${url}
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "reddit-tip");
    assert.match(rows[0]!.details, /UNVERIFIED/);
  });

  it("skips a post already on the desk and reports filed: false, without a duplicate row", async () => {
    await ensureDarkSchema();
    const user = `reddit-tip-dup-${Date.now()}`;
    const url = `https://www.reddit.com/r/longmont/comments/${Date.now()}/dup/`;
    const first = await fileRedditTipFor(user, DEFAULT_NEWSROOM_ID, { url, title: "First file" });
    assert.equal(first.filed, true);

    const second = await fileRedditTipFor(user, DEFAULT_NEWSROOM_ID, { url, title: "Second attempt, same url" });
    assert.equal(second.filed, false);
    assert.equal(second.ok, true);

    const sql = await getSql();
    const rows = await sql<{ id: number }>`select id from anomalies where url = ${url}`;
    assert.equal(rows.length, 1, "the second file-as-tip must not create a duplicate row");
  });

  it("does not cross newsrooms: a post filed under one newsroom can still be filed under another", async () => {
    await ensureDarkSchema();
    const user = `reddit-tip-nr-${Date.now()}`;
    const url = `https://www.reddit.com/r/longmont/comments/${Date.now()}/nr/`;
    const a = await fileRedditTipFor(user, 1, { url, title: "Same url" });
    const b = await fileRedditTipFor(user, 2, { url, title: "Same url" });
    assert.equal(a.filed, true);
    assert.equal(b.filed, true);
  });
});

function post(over: Partial<RedditPost>): RedditPost {
  return { title: "", url: "", updated: "", author: "", excerpt: "", ...over };
}

/**
 * The shape `scanTipSubreddit` now sends the editor for its "Top scored
 * posts" list: every post read, sorted best first, each carrying which of
 * the three fates it met. Previously `topScores` was sliced from the
 * already-filtered `picked` list, so a near miss (below the civic threshold)
 * never reached the editor at all -- exactly the case the owner hit with 49
 * reads and 0 filed.
 */
describe("classifyRedditPosts (Check r/longmont: near misses stay visible)", () => {
  it("classifies a filed post, an already-known post, and a below-line post", () => {
    const filedPost = post({
      title: "City council votes on rezoning",
      url: "https://www.reddit.com/r/longmont/comments/1/a/",
      excerpt: "council votes on the rezoning ordinance tonight",
    });
    const knownPost = post({
      title: "Public hearing on the budget",
      url: "https://www.reddit.com/r/longmont/comments/2/b/",
      excerpt: "public hearing scheduled to discuss the budget ordinance",
    });
    const chatPost = post({
      title: "Best pizza in town?",
      url: "https://www.reddit.com/r/longmont/comments/3/c/",
      excerpt: "looking for a recommendation, anyone know a good pizza place",
    });

    const out = classifyRedditPosts(
      [filedPost, knownPost, chatPost],
      [knownPost.url],
      [filedPost.url],
    );

    const byUrl = new Map(out.map((p) => [p.url, p]));
    assert.equal(byUrl.get(filedPost.url)?.state, "filed");
    assert.equal(byUrl.get(knownPost.url)?.state, "already-known");
    assert.equal(byUrl.get(chatPost.url)?.state, "below-line");
  });

  it("scores a post below the civic threshold as below-line even if its url happens to be in the filed/known sets", () => {
    const weak = post({
      title: "hello longmont",
      url: "https://www.reddit.com/r/longmont/comments/9/weak/",
      excerpt: "just moved here, excited to explore",
    });
    const out = classifyRedditPosts([weak], [], [weak.url]);
    assert.equal(out[0]!.state, "below-line");
  });

  it("sorts by score, best first", () => {
    const low = post({ title: "weather today", url: "u1", excerpt: "" });
    const high = post({
      title: "city council votes on the rezoning ordinance and budget",
      url: "u2",
      excerpt: "public hearing, ordinance no. 22-01, $250,000 contract",
    });
    const out = classifyRedditPosts([low, high], [], []);
    assert.equal(out[0]!.url, "u2");
    assert.ok(out[0]!.score >= out[1]!.score);
  });
});
