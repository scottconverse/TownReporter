import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../migrations/0025_model_choice.sql", import.meta.url),
  "utf8",
);

const REQUEST_COLUMNS = [
  "id", "user_id", "newsroom_id", "subject", "source_kind", "source_ref",
  "asked_for", "pointers_json", "our_story_json", "draft_id", "error",
  "model_choice", "created_at", "finished_at",
].sort();

async function columns(db, table) {
  const result = await db.query(
    `select column_name, column_default, is_nullable
       from information_schema.columns
      where table_name = $1
      order by column_name`,
    [table],
  );
  return result.rows;
}

function modelColumn(rows) {
  return rows.find((row) => row.column_name === "model_choice");
}

test("model-choice migration boots before Opinion has ever created its table", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table desk_jobs (
        id serial primary key,
        user_id text not null,
        kind text not null,
        subject_id integer not null default 0
      )
    `);
    await db.exec(migration);
    await db.exec(migration);

    const jobs = await columns(db, "desk_jobs");
    const requests = await columns(db, "editorial_requests");
    assert.match(String(modelColumn(jobs)?.column_default), /auto/);
    assert.equal(modelColumn(jobs)?.is_nullable, "NO");
    assert.match(String(modelColumn(requests)?.column_default), /auto/);
    assert.equal(modelColumn(requests)?.is_nullable, "NO");
    assert.deepEqual(
      requests.map((row) => row.column_name).sort(),
      REQUEST_COLUMNS,
      "migration-created Opinion schema must match ensureEditorialRequestSchema",
    );

    await db.exec(`
      insert into desk_jobs (user_id, kind, subject_id) values ('new-user', 'draft', 9);
      insert into editorial_requests (user_id, subject) values ('new-user', 'new request');
    `);
    const defaults = await db.query(`
      select model_choice from desk_jobs where user_id = 'new-user'
      union all
      select model_choice from editorial_requests where user_id = 'new-user'
    `);
    assert.deepEqual(defaults.rows, [{ model_choice: "auto" }, { model_choice: "auto" }]);
  } finally {
    await db.close();
  }
});

test("model-choice migration preserves and backfills populated pre-0025 rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table desk_jobs (
        id serial primary key,
        newsroom_id integer not null default 1,
        user_id text not null,
        kind text not null,
        subject_id integer not null default 0,
        status text not null default 'queued',
        stage text not null default '',
        error text,
        result_json text not null default '{}',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        started_at timestamptz,
        finished_at timestamptz
      );
      insert into desk_jobs (newsroom_id, user_id, kind, subject_id, status, stage)
      values (7, 'old-editor', 'draft', 41, 'running', 'Writing');

      create table editorial_requests (
        id serial primary key,
        user_id text not null,
        newsroom_id integer not null default 1,
        subject text not null,
        source_kind text not null default 'paste',
        source_ref text not null default '',
        asked_for text not null default '',
        pointers_json text not null default '[]',
        our_story_json text,
        draft_id integer,
        error text,
        created_at timestamptz not null default now(),
        finished_at timestamptz
      );
      insert into editorial_requests
        (user_id, newsroom_id, subject, source_kind, source_ref, asked_for, pointers_json, error)
      values
        ('old-editor', 7, 'Keep this subject', 'paste', 'Keep this source',
         'Keep this request', '[{"what":"keep"}]', 'Keep this error');
    `);

    await db.exec(migration);
    await db.exec(migration);

    const jobs = await db.query(`
      select newsroom_id, user_id, kind, subject_id, status, stage, model_choice
      from desk_jobs where user_id = 'old-editor'
    `);
    assert.deepEqual(jobs.rows, [{
      newsroom_id: 7, user_id: "old-editor", kind: "draft", subject_id: 41,
      status: "running", stage: "Writing", model_choice: "auto",
    }]);

    const requests = await db.query(`
      select user_id, newsroom_id, subject, source_kind, source_ref, asked_for,
             pointers_json, error, model_choice
      from editorial_requests where user_id = 'old-editor'
    `);
    assert.deepEqual(requests.rows, [{
      user_id: "old-editor", newsroom_id: 7, subject: "Keep this subject",
      source_kind: "paste", source_ref: "Keep this source",
      asked_for: "Keep this request", pointers_json: '[{"what":"keep"}]',
      error: "Keep this error", model_choice: "auto",
    }]);

    const requestColumns = await columns(db, "editorial_requests");
    assert.deepEqual(
      requestColumns.map((row) => row.column_name).sort(),
      REQUEST_COLUMNS,
      "upgraded legacy Opinion schema must match ensureEditorialRequestSchema",
    );
    assert.equal(modelColumn(requestColumns)?.is_nullable, "NO");
    assert.match(String(modelColumn(requestColumns)?.column_default), /auto/);
  } finally {
    await db.close();
  }
});
