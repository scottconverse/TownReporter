import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("source identity migration preserves historical rows and permits the same editor URL in two rooms", async () => {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(await readFile(new URL("../../../migrations/0002_newsroom.sql", import.meta.url), "utf8"));
  await pg.exec("alter table sources add column newsroom_id integer not null default 1");
  await pg.exec(`
    insert into sources(user_id,newsroom_id,url,title)
    values
      ('source-owner',1,'https://example.org/shared','Original'),
      ('source-editor',1,'https://example.org/shared','Historical duplicate')
  `);
  const migration = await readFile(
    new URL("../../../migrations/0056_newsroom_source_identity.sql", import.meta.url),
    "utf8",
  );
  await pg.exec(migration);
  await pg.exec(migration);
  await pg.exec(`
    insert into sources(user_id,newsroom_id,url,title)
    values('source-owner',2,'https://example.org/shared','Independent room')
  `);
  const result = await pg.query<{ user_id: string; newsroom_id: number; title: string }>(
    "select user_id,newsroom_id,title from sources order by id",
  );
  assert.deepEqual(result.rows, [
    { user_id: "source-owner", newsroom_id: 1, title: "Original" },
    { user_id: "source-editor", newsroom_id: 1, title: "Historical duplicate" },
    { user_id: "source-owner", newsroom_id: 2, title: "Independent room" },
  ]);
  await pg.close();
});
