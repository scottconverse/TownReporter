import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { ensurePageWatchSchema } from "./page-watch.ts";
import { retainedWatchSources } from "./retained-watch-source.server.ts";

const newsroomId = 991234;
const userId = "retained-watch-source-test";
const url = "https://example.test/watch-retained-pdf";
let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;

before(async () => {
  vite = await createServer({ configFile: false, server: { middlewareMode: true }, resolve: { alias: { "@": join(process.cwd(), "src") } } });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  const sql = await getSql();
  await ensurePageWatchSchema();
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict(id) do nothing", [
    newsroomId,
    "Retained watch source test",
  ]);
  await sql.query(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness) values($1,$2,$3,$4,$5,'new',$6,'',1)",
    [userId, newsroomId, "Retained capture lead", "A watched source changed", "council", JSON.stringify([url])],
  );
});

after(async () => {
  const sql = await getSql();
  await sql.query("delete from manual_watch_actions where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from manual_watch_checks where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from capture_events where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from artifact_versions where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from source_monitors where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from leads where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from newsrooms where id=$1", [newsroomId]);
  await vite.close();
});

test("retains the action-linked readable capture after a later failed check", async () => {
  const sql = await getSql();
  const [lead] = await sql.query<{ id: number }>(
    "select id from leads where newsroom_id=$1 and user_id=$2 order by id desc limit 1",
    [newsroomId, userId],
  );
  const [monitor] = await sql.query<{ id: number }>(
    "insert into source_monitors(user_id,newsroom_id,url,title) values($1,$2,$3,$4) returning id",
    [userId, newsroomId, url, "Scanned permit record"],
  );
  const [version] = await sql.query<{ id: number }>(
    "insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,$4,$5,$6) returning id",
    [userId, newsroomId, url, "sha256:original", "Scanned permit record", "ORIGINAL OCR TEXT FROM VERSION 1560"],
  );
  const [capture] = await sql.query<{ id: number }>(
    "insert into capture_events(user_id,newsroom_id,source_url,fetch_outcome,version_id,monitor_id,content_hash,extraction_method) values($1,$2,$3,'changed',$4,$5,$6,'ocr:12/44') returning id",
    [userId, newsroomId, url, version.id, monitor.id, "sha256:original"],
  );
  const [check] = await sql.query<{ id: number }>(
    "insert into manual_watch_checks(newsroom_id,monitor_id,capture_event_id,state) values($1,$2,$3,'changed') returning id",
    [newsroomId, monitor.id, capture.id],
  );
  await sql.query(
    "insert into manual_watch_actions(newsroom_id,check_id,action,target_id,result_id) values($1,$2,'lead',0,$3)",
    [newsroomId, check.id, lead.id],
  );
  await sql.query(
    "insert into capture_events(user_id,newsroom_id,source_url,fetch_outcome,version_id,monitor_id,content_hash,extraction_method) values($1,$2,$3,'fetch-failed',null,$4,null,'')",
    [userId, newsroomId, url, monitor.id],
  );

  const retained = await retainedWatchSources(sql, newsroomId, lead.id, [url]);
  assert.deepEqual(retained.map((source) => ({
    text: source.text,
    version_id: source.version_id,
    capture_event_id: source.capture_event_id,
  })), [{
    text: "ORIGINAL OCR TEXT FROM VERSION 1560",
    version_id: version.id,
    capture_event_id: capture.id,
  }]);
});

test("does not return a watch capture across newsroom boundaries", async () => {
  const sql = await getSql();
  const [lead] = await sql.query<{ id: number }>(
    "select id from leads where newsroom_id=$1 and user_id=$2 order by id desc limit 1",
    [newsroomId, userId],
  );
  assert.deepEqual(await retainedWatchSources(sql, newsroomId + 1, lead.id, [url]), []);
});
