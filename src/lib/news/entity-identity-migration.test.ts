import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getPglite, getSql } from "../db.ts";

test("identity migration preserves historical rows and permits the same user's pair in another room", async () => {
  const pg = await getPglite();
  const sql = await getSql();
  const original = await readFile(
    new URL("../../../migrations/0007_forensics.sql", import.meta.url),
    "utf8",
  );
  for (const table of ["entity_aliases", "entity_matches"]) {
    const ddl = original.match(
      new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\);`),
    )?.[0];
    assert.ok(ddl);
    await pg.exec(ddl);
    await sql.query(`alter table ${table} add column newsroom_id integer not null default 1`);
  }
  await sql`insert into entity_aliases(user_id,canonical,alias,evidence) values ('shared','vendor llc','Vendor Inc','Historical evidence'),('collaborator','vendor llc','Vendor Inc','Other editor evidence')`;
  await sql`insert into entity_matches(user_id,left_canonical,right_canonical,evidence) values ('shared','vendor inc','vendor llc','Historical match'),('collaborator','vendor inc','vendor llc','Other editor match')`;
  const aliases = await sql`select * from entity_aliases order by id`;
  const matches = await sql`select * from entity_matches order by id`;
  const migration = await readFile(
    new URL("../../../migrations/0044_entity_identity_newsrooms.sql", import.meta.url),
    "utf8",
  );
  await pg.exec(migration);
  await pg.exec(migration);
  assert.deepEqual(await sql`select * from entity_aliases order by id`, aliases);
  assert.deepEqual(await sql`select * from entity_matches order by id`, matches);
  await sql`insert into entity_aliases(user_id,newsroom_id,canonical,alias,evidence) values ('shared',2,'vendor llc','Vendor Inc','Room 2 only')`;
  await sql`insert into entity_matches(user_id,newsroom_id,left_canonical,right_canonical,evidence) values ('shared',2,'vendor inc','vendor llc','Room 2 match')`;
  await assert.rejects(
    sql`insert into entity_aliases(user_id,newsroom_id,canonical,alias) values ('shared',2,'vendor llc','Vendor Inc')`,
    /duplicate key/,
  );
  await assert.rejects(
    sql`insert into entity_matches(user_id,newsroom_id,left_canonical,right_canonical) values ('shared',2,'vendor inc','vendor llc')`,
    /duplicate key/,
  );
});
