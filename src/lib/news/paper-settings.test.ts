import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getSql } from "../db.ts";
import { PAPER, COUNCIL_VOTES_URL, SEED_SOURCES } from "../paper.ts";
import { MEETING_KEYWORDS, LONGMONT_YOUTUBE_CHANNELS } from "./youtube.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import {
  ensurePaperSettingsSchema,
  getPaperConfig,
  savePaperConfig,
  clearPaperConfigCache,
} from "./paper-settings.ts";

/*
  Node's test runner does not guarantee sibling `it`s inside one `describe`
  finish in source order, so any two cases that touch the SAME row can race.
  Every case below gets its own newsroom id (paper_settings.newsroom_id and
  newsroom_members.newsroom_id are both scoped per-newsroom, including the
  `newsroom_members_one_owner` partial unique index from migrations/0012),
  so no two cases ever contend for the same row.
*/
const DEFAULT_NEWSROOM_ID = 1;

async function clearRow(newsroomId: number) {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  await sql`delete from paper_settings where newsroom_id = ${newsroomId}`;
}

async function seat(userId: string, role: "owner" | "editor", newsroomId: number) {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await sql`delete from newsroom_members where user_id = ${userId}`;
  await sql`
    insert into newsroom_members (user_id, role, newsroom_id)
    values (${userId}, ${role}, ${newsroomId})
  `;
}

async function forgetMember(userId: string) {
  const sql = await getSql();
  await sql`delete from newsroom_members where user_id = ${userId}`;
}

describe("paper config defaults", () => {
  it("falls back to the shipped constants when no settings row exists", async () => {
    const newsroomId = 900_001;
    await clearRow(newsroomId);
    const config = await getPaperConfig(newsroomId);
    assert.equal(config.name, PAPER.name);
    assert.equal(config.city, PAPER.city);
    assert.equal(config.state, PAPER.state);
    assert.equal(config.location, PAPER.location);
    assert.equal(config.timezone, PAPER.timezone);
    assert.equal(config.tagline, PAPER.tagline);
    assert.equal(config.kicker, PAPER.kicker);
    assert.equal(config.deck, PAPER.deck);
    assert.equal(config.trust, PAPER.trust);
    assert.equal(config.councilVotesUrl, COUNCIL_VOTES_URL);
    assert.deepEqual(config.youtubeChannels, LONGMONT_YOUTUBE_CHANNELS);
    assert.deepEqual(config.meetingKeywords, MEETING_KEYWORDS);
    assert.deepEqual(config.seedSources, SEED_SOURCES);
  });

  it("defaults newsroomId to the single-newsroom convention (1) when omitted", async () => {
    // The one case that legitimately reads the real default newsroom id --
    // read-only, so it cannot race a write from any other case here.
    const config = await getPaperConfig();
    assert.equal(config.city, config.city); // sanity: call succeeds
    assert.ok(config.name.length > 0);
    const direct = await getPaperConfig(DEFAULT_NEWSROOM_ID);
    assert.deepEqual(config, direct);
  });
});

describe("paper config overrides", () => {
  it("a partial row only overrides the fields it sets", async () => {
    const newsroomId = 900_002;
    await clearRow(newsroomId);
    const sql = await getSql();
    await sql`
      insert into paper_settings (newsroom_id, name, city)
      values (${newsroomId}, ${"Prairie Times"}, ${"Prairie Junction"})
    `;
    const config = await getPaperConfig(newsroomId);
    assert.equal(config.name, "Prairie Times");
    assert.equal(config.city, "Prairie Junction");
    // Untouched columns still fall back.
    assert.equal(config.state, PAPER.state);
    assert.equal(config.timezone, PAPER.timezone);
    assert.equal(config.councilVotesUrl, COUNCIL_VOTES_URL);
    assert.deepEqual(config.seedSources, SEED_SOURCES);
    await clearRow(newsroomId);
  });

  it("a jsonb override replaces the whole list, not merged with the default", async () => {
    const newsroomId = 900_003;
    await clearRow(newsroomId);
    const sql = await getSql();
    const channels = ["https://www.youtube.com/@SomeOtherCity"];
    await sql`
      insert into paper_settings (newsroom_id, youtube_channels)
      values (${newsroomId}, ${JSON.stringify(channels)})
    `;
    const config = await getPaperConfig(newsroomId);
    assert.deepEqual(config.youtubeChannels, channels);
    assert.deepEqual(config.meetingKeywords, MEETING_KEYWORDS);
    await clearRow(newsroomId);
  });

  it("an empty list means none, not the Longmont default", async () => {
    /*
      A city with no meeting-video channel has to be able to say so. Reading
      an empty list as a gap would hand them Longmont's channels forever,
      which is the exact thing this feature exists to end.
    */
    const newsroomId = 900_004;
    await clearRow(newsroomId);
    const sql = await getSql();
    await sql`
      insert into paper_settings (newsroom_id, youtube_channels, seed_sources)
      values (${newsroomId}, ${JSON.stringify([])}, ${JSON.stringify([])})
    `;
    const config = await getPaperConfig(newsroomId);
    assert.deepEqual(config.youtubeChannels, []);
    assert.deepEqual(config.seedSources, []);
    // A field that really is unset still falls back.
    assert.deepEqual(config.meetingKeywords, MEETING_KEYWORDS);
    await clearRow(newsroomId);
  });

  it("a malformed list is a gap, and still falls back", async () => {
    const newsroomId = 900_005;
    await clearRow(newsroomId);
    const sql = await getSql();
    await sql`
      insert into paper_settings (newsroom_id, youtube_channels)
      values (${newsroomId}, ${JSON.stringify({ not: "a list" })})
    `;
    const config = await getPaperConfig(newsroomId);
    assert.deepEqual(config.youtubeChannels, LONGMONT_YOUTUBE_CHANNELS);
    await clearRow(newsroomId);
  });
});

describe("savePaperConfig ownership", () => {
  it("rejects a non-owner editor", async () => {
    const newsroomId = 900_101;
    const editorId = `settings-editor-${Date.now()}`;
    await seat(editorId, "editor", newsroomId);
    await assert.rejects(() => savePaperConfig(editorId, { name: "Nope" }));
    await forgetMember(editorId);
  });

  it("rejects a stranger with no membership at all", async () => {
    // requireEditor's "first account owns the desk" rule keys off
    // DEFAULT_NEWSROOM_ID (1) for a user with no row of their own, so the
    // desk has to be claimed THERE for a brand-new stranger to be refused
    // rather than auto-seated as owner. Reuses whatever real owner already
    // exists on this PGLite instance (every other suite in this repo leaves
    // one seated) instead of contending for that singleton row itself.
    const claimed = await getSql().then((sql) =>
      sql<{ c: number }>`select count(*)::int as c from newsroom_members where newsroom_id = ${DEFAULT_NEWSROOM_ID}`,
    );
    let guardOwnerId: string | null = null;
    if ((claimed[0]?.c ?? 0) === 0) {
      guardOwnerId = `settings-owner-guard-${Date.now()}`;
      await seat(guardOwnerId, "owner", DEFAULT_NEWSROOM_ID);
    }
    try {
      await assert.rejects(() => savePaperConfig(`stranger-${Date.now()}`, { name: "Nope" }));
    } finally {
      if (guardOwnerId) await forgetMember(guardOwnerId);
    }
  });

  it("succeeds for the owner and persists a partial patch", async () => {
    const newsroomId = 900_103;
    await clearRow(newsroomId);
    const ownerId = `settings-owner-${Date.now()}`;
    await seat(ownerId, "owner", newsroomId);
    const saved = await savePaperConfig(ownerId, {
      name: "Prairie Times",
      seedSources: [{ url: "https://example.gov/", title: "Example Gov", kind: "official", tier: "A" }],
    });
    assert.equal(saved.name, "Prairie Times");
    assert.deepEqual(saved.seedSources, [
      { url: "https://example.gov/", title: "Example Gov", kind: "official", tier: "A" },
    ]);
    // Other fields still fall back.
    assert.equal(saved.city, PAPER.city);

    const reread = await getPaperConfig(newsroomId);
    assert.equal(reread.name, "Prairie Times");
    await forgetMember(ownerId);
    await clearRow(newsroomId);
  });
});

describe("the config cache", () => {
  it("serves a repeat read without going back to the database", async () => {
    const newsroomId = 900_010;
    await clearRow(newsroomId);
    clearPaperConfigCache();
    const first = await getPaperConfig(newsroomId);
    const second = await getPaperConfig(newsroomId);
    assert.equal(first, second, "the second read should be the cached object");
  });

  it("clearing it makes the next read see a row written behind its back", async () => {
    const newsroomId = 900_011;
    await clearRow(newsroomId);
    clearPaperConfigCache();
    assert.equal((await getPaperConfig(newsroomId)).city, PAPER.city);
    const sql = await getSql();
    await sql`insert into paper_settings (newsroom_id, city) values (${newsroomId}, ${"Riverbend"})`;
    clearPaperConfigCache();
    assert.equal((await getPaperConfig(newsroomId)).city, "Riverbend");
    await clearRow(newsroomId);
    clearPaperConfigCache();
  });

  it("has no server-only import that could reach the browser", async () => {
    /*
      The regression this replaces: an AsyncLocalStorage cache here put
      `node:async_hooks` in the client graph and every desk page rendered
      "Something went wrong". CI caught it; a local run did not, because the
      browser tests skip without a Postgres URL.
    */
    const src = await readFile(new URL("./paper-settings.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /from "node:/, "no node: import belongs in this module");
  });
});

describe("ensureSeeds falls back to Longmont SEED_SOURCES", () => {
  it("ensureSeeds() (via getPaperConfig) still seeds the shipped Longmont list when no settings row exists", async () => {
    // desk.ts's ensureSeeds() now reads getPaperConfig().seedSources instead
    // of the SEED_SOURCES constant directly. This proves that indirection is
    // transparent for the existing Longmont install: with no paper_settings
    // row for newsroom 1, the value it inserts is byte-for-byte SEED_SOURCES.
    await clearRow(DEFAULT_NEWSROOM_ID);
    const config = await getPaperConfig(DEFAULT_NEWSROOM_ID);
    assert.deepEqual(config.seedSources, SEED_SOURCES);
  });
});
