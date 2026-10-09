// Loaded only by the local CI walk's disposable, sealed server process.
if (process.env.UIWALK_LOCAL_FIXTURE !== "1" || process.env.DATABASE_URL || process.env.TOWNREPORTER_TEST_ENV_VERIFIED !== "1") throw new Error("Dark fixture requires the isolated local CI walk");
let seeded = false;
let seeding = false;
const timer = setInterval(async () => {
  if (seeded || seeding || !globalThis.__pgliteInstance__) return;
  seeding = true;
  try {
    const db = await globalThis.__pgliteInstance__;
    const { rows } = await db.query("select user_id, newsroom_id from newsroom_members where role = 'owner' limit 1");
    if (!rows.length) return;
    const { user_id: user, newsroom_id: newsroom } = rows[0];
    await db.transaction(async (tx) => {
      const { rows: files } = await tx.query("insert into investigations (user_id, newsroom_id, title, status, last_model_choice, limit_key, limit_minutes, scope_json) values ($1,$2,$3,'closed','codex-frontier','standard',120,$4) returning id", [user, newsroom, "r/longmont: Firestone Boulevard & I-25 Frontage Road Construction Contract", '{"scope":"city"}']);
      const id = files[0].id;
      await tx.query("insert into search_log (user_id, newsroom_id, investigation_id, hop, query, results_json) select $1,$2,$3,1,'public construction records','[]' from generate_series(1,363)", [user, newsroom, id]);
      await tx.query("insert into dead_ends (user_id, newsroom_id, investigation_id, hypothesis, dedup_key) select $1,$2,$3,'The public construction record did not support explanation ' || generate_series, 'walk-' || generate_series from generate_series(1,60)", [user, newsroom, id]);
      await tx.query("insert into dark_runs (user_id, newsroom_id, investigation_id, finished_at, summary) select $1,$2,$3,now(),'The saved case file remains ready for the editor' from generate_series(1,30)", [user, newsroom, id]);
      for (let i = 0; i < 363; i++) {
        const url = `https://example.test/public-record/${i}`;
        // Retain 262 records overall, with the real file's 43 blocked pages
        // among its latest 60 attempts so its guidance also consumes space.
        const saved = i < 245 || i >= 346;
        const { rows: captures } = await tx.query("insert into capture_events (user_id, newsroom_id, investigation_id, source_url, fetch_outcome, http_status) values ($1,$2,$3,$4,$5,$6) returning id", [user, newsroom, id, url, saved ? "fetched" : "failed", saved ? 200 : 403]);
        const capture = captures[0].id;
        const text = saved ? "The construction contract was discussed by the Board of Trustees after the public hearing. ".repeat(6) : "Access denied";
        await tx.query("insert into artifacts (user_id, newsroom_id, investigation_id, url, title, content_hash, full_text, classification, fetch_status, capture_event_id) values ($1,$2,$3,$4,$5,$6,$7,'captured',$8,$9)", [user, newsroom, id, url, "Firestone Boulevard and I-25 Frontage Road Construction Contract — Board of Trustees public hearing", String(i), text, saved ? 200 : 403, capture]);
        if (!saved) continue;
        await tx.query("insert into claims (user_id, newsroom_id, investigation_id, body, kind, confidence, capture_event_id) values ($1,$2,$3,$4,'FINDING',0.9,$5)", [user, newsroom, id, text, capture]);
      }
    });
    seeded = true; clearInterval(timer);
    console.log("Local Dark Desk fixture ready: 262 findings, 363 capture activity records");
  } catch (error) {
    if (!/does not exist/.test(error.message)) { clearInterval(timer); console.error("Local Dark Desk fixture failed:", error.message); }
  } finally { seeding = false; }
}, 250);
timer.unref();
