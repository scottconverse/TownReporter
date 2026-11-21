import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { followDirectoryLinksIn } from "./link-following.server.ts";

await applyMigrationsToTestPglite();

async function addDirectorySource(newsroomId: number, url: string): Promise<number> {
  const sql = await getSql();
  const [row] = await sql.query<{ id: number }>(
    `insert into sources (user_id, newsroom_id, url, title, kind, tier, status)
     values ('link-scan', $1, $2, 'Resource directory', 'official', 'A', 'accepted')
     returning id`,
    [newsroomId, url],
  );
  await sql.query(
    `insert into resource_sources (newsroom_id, source_id, registry_role, directory_name)
     values ($1, $2, 'directory', 'Resource directory')`,
    [newsroomId, row!.id],
  );
  return Number(row!.id);
}

test("a directory page's official links become accepted registry sources, once", async () => {
  const sql = await getSql();
  const newsroomId = 9601;
  const directoryId = await addDirectorySource(
    newsroomId,
    "https://longmontcolorado.gov/resources",
  );

  const pages = [
    {
      pageUrl: "https://longmontcolorado.gov/resources",
      links: [
        { url: "https://www.ourcenter.org/referral-program/", title: "OUR Center" },
        { url: "https://www.facebook.com/ourcenter", title: "Facebook" },
        { url: "https://www.google.com/search?q=food", title: "Search" },
      ],
    },
  ];

  const first = await followDirectoryLinksIn(sql, {
    newsroomId,
    userId: "link-scan",
    pages,
  });
  assert.equal(first.added, 1);

  const [added] = await sql.query<{ id: number; status: string; title: string }>(
    "select id, status, title from sources where newsroom_id = $1 and url = 'https://www.ourcenter.org/referral-program/'",
    [newsroomId],
  );
  assert.equal(added!.status, "accepted");
  assert.equal(added!.title, "OUR Center");
  const [role] = await sql.query<{ registry_role: string }>(
    "select registry_role from resource_sources where newsroom_id = $1 and source_id = $2",
    [newsroomId, added!.id],
  );
  assert.equal(role!.registry_role, "organization");

  const second = await followDirectoryLinksIn(sql, {
    newsroomId,
    userId: "link-scan",
    pages,
  });
  assert.equal(second.added, 0, "a second pass adds nothing");
  const [count] = await sql.query<{ count: string }>(
    "select count(*)::text as count from sources where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(Number(count!.count), 2, "the directory and one followed page");
  void directoryId;
});

test("the daily cap stops link-following once today's allowance is spent", async () => {
  const sql = await getSql();
  const newsroomId = 9602;
  for (let i = 0; i < 25; i += 1) {
    const [row] = await sql.query<{ id: number }>(
      `insert into sources (user_id, newsroom_id, url, title, kind, tier, status)
       values ('link-scan', $1, $2, 'Already linked', 'official', 'B', 'accepted') returning id`,
      [newsroomId, `https://already-${i}.org/`],
    );
    await sql.query(
      `insert into resource_sources (newsroom_id, source_id, registry_role)
       values ($1, $2, 'organization')`,
      [newsroomId, row!.id],
    );
  }

  const result = await followDirectoryLinksIn(sql, {
    newsroomId,
    userId: "link-scan",
    pages: [
      {
        pageUrl: "https://longmontcolorado.gov/resources",
        links: [{ url: "https://www.ourcenter.org/", title: "OUR Center" }],
      },
    ],
  });
  assert.equal(result.added, 0, "25 sources already created today");
});
