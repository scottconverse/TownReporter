// guards: the paste preview could present unverified sources as official records.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DARK_LIMITS,
  FIND_SOURCE_SCOPES,
  UPDATED_TEXT,
  addSourcesLabel,
  appendPastedText,
  findSourcesPrompt,
  hopsForLimit,
  insertUpdateAtTop,
  parseProposedSources,
  parseScore,
  previewSources,
  previewSplit,
  scopeFromKey,
  sourceKindLabel,
  badSourceKillsBySource,
  sourceUrlsContain,
  updateStamp,
  weavePrompt,
} from "./editor-dialog-logic.ts";
import { parseSourceLines } from "./source-lines.ts";
import { sourceIdentity } from "./url-guard.ts";

const PASTE = [
  "https://longmontcolorado.gov/news",
  "The Boulder Beat | https://www.bouldercounty.gov/records | County records",
].join("\n");

describe("the add-sources preview", () => {
  it("marks a row already watched by identity, not by string", () => {
    const preview = previewSources(PASTE, ["https://www.longmontcolorado.gov/news"]);
    assert.equal(preview.found, 2);
    assert.equal(preview.newCount, 1);
    assert.equal(preview.watchedCount, 1);
    assert.equal(previewSplit(preview), "1 new · 1 already watched");
    const watched = preview.rows.find((r) => !r.isNew)!;
    assert.equal(watched.url, "https://longmontcolorado.gov/news");
    assert.equal(watched.kind, "Already watched");
    assert.equal(preview.rows.find((r) => r.isNew)!.kind, "Official page");
  });

  it("says only the new count when nothing is watched", () => {
    const preview = previewSources(PASTE, []);
    assert.equal(previewSplit(preview), "2 new");
    assert.equal(preview.watchedCount, 0);
    assert.ok(!preview.rows.some((r) => r.kind === "Already watched"));
  });

  it("de-duplicates inside one paste, so the count is of rows and not of lines", () => {
    const preview = previewSources("https://x.example/news\nhttps://www.x.example/news", []);
    assert.equal(preview.rows.length, 1);
    assert.equal(previewSplit(preview), "1 new");
    assert.equal(addSourcesLabel(preview.rows.length), "Add 1 source");
    assert.equal(addSourcesLabel(3), "Add 3 sources");
  });

  it("names a feed as a feed and a tier-B page as a news page", () => {
    const rows = parseSourceLines("TIER B\nhttps://records.example/x");
    assert.equal(sourceKindLabel(rows[0]!), "News page");
    assert.equal(sourceKindLabel(parseSourceLines("https://x.example/feed")[0]!), "RSS");
    assert.equal(sourceKindLabel(parseSourceLines("https://city.gov/rss.xml")[0]!), "Official page");
    assert.equal(sourceKindLabel(parseSourceLines("https://www.youtube.com/@council")[0]!), "Video");
  });
});

describe("the Dark Desk limits", () => {
  it("maps each drawn dial to the hops the engine spends, and defaults unknown keys to 5", () => {
    assert.deepEqual(DARK_LIMITS.map((l) => l.key), ["quick", "standard", "deep"]);
    assert.deepEqual(DARK_LIMITS.map((l) => hopsForLimit(l.key)), [2, 5, 10]);
    assert.deepEqual(DARK_LIMITS.map((l) => l.hops), [2, 5, 10]);
    assert.equal(hopsForLimit("not-a-dial"), 5);
    assert.equal(hopsForLimit(""), 5);
  });
});

describe("what Add-as-an-update and the as-is paste write", () => {
  it("puts the stamped line at the top, in the desk's own local format", () => {
    const at = new Date("2026-09-26T14:05:00Z");
    const body = "  The council met on Tuesday.  ";
    const out = insertUpdateAtTop(body, "  It voted 4-3.  ", at);
    assert.equal(out, `${UPDATED_TEXT} ${updateStamp(at)}: It voted 4-3.\n\nThe council met on Tuesday.`);
    assert.ok(out.endsWith("The council met on Tuesday."), "the body is trimmed, not doubled");
    assert.match(updateStamp(at), /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)$/);
    assert.equal(UPDATED_TEXT, "Updated");
  });

  it("writes the update alone when there is no body yet", () => {
    const out = insertUpdateAtTop("   ", "It voted 4-3.", new Date("2026-09-26T14:05:00Z"));
    assert.ok(out.startsWith("Updated "));
    assert.ok(!out.includes("\n\n"), out);
  });

  it("appends the as-is paste after the story, and pastes alone onto an empty one", () => {
    assert.equal(appendPastedText("The council met.", "  It voted 4-3.  "), "The council met.\n\nIt voted 4-3.");
    assert.equal(appendPastedText("", "It voted 4-3."), "It voted 4-3.");
    // The end, not the top: the two no-AI modes write in opposite directions.
    assert.ok(!appendPastedText("The council met.", "It voted.").startsWith("It voted."));
  });
});

describe("the find-sources prompt", () => {
  it("carries the topic and the scope's own label, and falls back to the first scope", () => {
    const prompt = findSourcesPrompt("  Longmont water  ", "organizations");
    assert.match(prompt.user, /What the paper covers: Longmont water/);
    assert.match(prompt.user, new RegExp(FIND_SOURCE_SCOPES[1].label));
    assert.equal(scopeFromKey("not-a-scope"), FIND_SOURCE_SCOPES[0]);
    assert.match(findSourcesPrompt("water", "not-a-scope").user, new RegExp(FIND_SOURCE_SCOPES[0].label));
    assert.match(prompt.system, /URL \| name \| why/);
  });
});

describe("the rows out of a model answer", () => {
  it("reads the URL | name | why rows the prompt asks for", () => {
    const rows = parseProposedSources("Records | https://records.example/minutes | It keeps the minutes\nhttps://b.example/news");
    assert.deepEqual(rows, [
      { url: "https://records.example/minutes", name: "Records", reason: "It keeps the minutes" },
      // No name given: the host stands in, so no row is filed nameless.
      { url: "https://b.example/news", name: "b.example", reason: "" },
    ]);
  });

  it("reads a JSON array too, and drops everything that is not a real URL", () => {
    const rows = parseProposedSources(
      'Here you go:\n[{"url":"https://a.example/x","name":"A","why":"records"}]',
    );
    assert.deepEqual(rows, [{ url: "https://a.example/x", name: "A", reason: "records" }]);
    assert.deepEqual(parseProposedSources("not a url at all\nsee records.example for more"), []);
    assert.deepEqual(parseProposedSources("1. ftp://files.example/x\n2. mailto:a@b.example"), []);
  });

  it("counts one source once, even when the model names it twice", () => {
    const rows = parseProposedSources(
      "https://www.a.example/news\nhttps://a.example/news\nhttps://b.example/news",
    );
    assert.deepEqual(rows.map((r) => r.url), ["https://www.a.example/news", "https://b.example/news"]);
  });

  it("stops at the ceiling the desk will file", () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://s${i}.example/news`).join("\n");
    assert.equal(parseProposedSources(many).length, 12);
    assert.equal(parseProposedSources(many, 3).length, 3);
    assert.equal(parseProposedSources(many).length, parseProposedSources(many).length);
  });

  it("strips the quoting a model wraps around a name", () => {
    const rows = parseProposedSources('"Records" | https://records.example/minutes | "keeps them"');
    assert.equal(rows[0]!.name, "Records");
    assert.equal(rows[0]!.reason, "keeps them");
  });
});

describe("the score out of a model answer", () => {
  it("reads one JSON object, clamped to the desk's 0-100", () => {
    assert.deepEqual(parseScore('{"score": 72, "reason": "It is new and checkable."}'), {
      score: 72,
      reason: "It is new and checkable.",
    });
    assert.deepEqual(parseScore('Sure:\n{"score": 140, "reason":"x"}\n')?.score, 100);
    assert.deepEqual(parseScore('{"score": -4, "reason":"x"}')?.score, 0);
    assert.deepEqual(parseScore('{"score": 71.6, "reason":"x"}')?.score, 72);
  });

  it("answers null rather than half a score when the model refused or rambled", () => {
    assert.equal(parseScore("I cannot score this lead."), null);
    assert.equal(parseScore(""), null);
    assert.equal(parseScore('{"reason": "no number here"}'), null);
    assert.equal(parseScore('{"score": null}'), null);
    assert.equal(parseScore('{ "score": "high" }'), null);
  });
});

describe("the weave prompt", () => {
  it("asks for the whole story back, and sends the headline and the material", () => {
    const prompt = weavePrompt({ headline: "Council delays the budget", body: "  The council met.  ", material: "  It voted 4-3.  " });
    assert.match(prompt.user, /Headline: Council delays the budget/);
    assert.match(prompt.user, /The story as it stands:\nThe council met\./);
    assert.match(prompt.user, /New material to fold in:\nIt voted 4-3\./);
    assert.match(prompt.system, /Return the whole story text and nothing else/);
  });
});

describe("does this lead come from this source", () => {
  it("matches on the watch list's identity, www and all", () => {
    const json = JSON.stringify(["https://www.longmontcolorado.gov/news"]);
    assert.equal(sourceUrlsContain(json, sourceIdentity("https://longmontcolorado.gov/news")), true);
    assert.equal(sourceUrlsContain(JSON.stringify(["https://longmontcolorado.gov/news"]), sourceIdentity("https://www.longmontcolorado.gov/news")), true);
  });

  it("never counts a longer path as the same source", () => {
    const identity = sourceIdentity("https://x.example/news");
    assert.equal(sourceUrlsContain(JSON.stringify(["https://x.example/news-archive"]), identity), false);
    assert.equal(sourceUrlsContain(JSON.stringify(["https://x.example/news"]), identity), true);
    assert.equal(sourceUrlsContain(JSON.stringify(["https://other.example/news"]), identity), false);
  });

  it("answers false for an absent, empty or malformed list, and for no source at all", () => {
    const identity = sourceIdentity("https://x.example/news");
    assert.equal(sourceUrlsContain(null, identity), false);
    assert.equal(sourceUrlsContain(undefined, identity), false);
    assert.equal(sourceUrlsContain("", identity), false);
    assert.equal(sourceUrlsContain("not json", identity), false);
    assert.equal(sourceUrlsContain('{"a":1}', identity), false);
    assert.equal(sourceUrlsContain("[1, null, 2]", identity), false);
    assert.equal(sourceUrlsContain(JSON.stringify(["https://x.example/news"]), null), false);
    assert.equal(sourceUrlsContain(JSON.stringify(["https://x.example/news"]), null), false);
  });
});

/**
 * The gate under a watch row (BJ3 item 3): the same numbers
 * `performSourceKillPattern` prints, computed for every row from one read.
 *
 * The window and the ordering are the server's (`killed_at` desc, nulls last,
 * then `id` desc, limit 500), so the cases below pin the two places they can
 * drift: which kills are in the window at all, and which lead counts for which
 * watch row.
 */
describe("the kill pattern under a watch row", () => {
  const url = "https://longmontcolorado.gov/news";
  const row = (
    source_urls: string | null,
    kill_reason: string | null,
    id: number,
    killed_at: string | null = "2026-01-01T00:00:00.000Z",
  ) => ({ id, killed_at, kill_reason, source_urls });

  it("counts a kill from the source once, and a bad-source kill in both numbers", () => {
    const counts = badSourceKillsBySource(
      [{ id: 7, url }],
      [
        row(JSON.stringify([url]), "Bad source or unreadable.", 2),
        row(JSON.stringify([url]), "Already printed — matches a story we ran.", 1),
      ],
    );
    assert.deepEqual(counts.get(7), { badSource: 1, killedFromSource: 2 });
  });

  it("matches on the watch list's identity, www and all, and never on a longer path", () => {
    const counts = badSourceKillsBySource(
      [{ id: 7, url }],
      [
        row(JSON.stringify(["https://www.longmontcolorado.gov/news"]), "unreadable", 3),
        row(JSON.stringify(["https://longmontcolorado.gov/news-archive"]), "unreadable", 2),
        row(JSON.stringify(["https://other.example/news"]), "unreadable", 1),
      ],
    );
    assert.deepEqual(counts.get(7), { badSource: 1, killedFromSource: 1 });
  });

  it("counts one lead for both watch rows when two of them are the same page", () => {
    const counts = badSourceKillsBySource(
      [
        { id: 7, url },
        { id: 8, url: "https://www.longmontcolorado.gov/news" },
      ],
      [row(JSON.stringify([url]), "unreadable", 1)],
    );
    assert.deepEqual(counts.get(7), { badSource: 1, killedFromSource: 1 });
    assert.deepEqual(counts.get(8), { badSource: 1, killedFromSource: 1 });
  });

  it("counts a lead once however many times its own list repeats the identity", () => {
    const counts = badSourceKillsBySource(
      [{ id: 7, url }],
      [row(JSON.stringify([url, "https://www.longmontcolorado.gov/news", url]), "unreadable", 1)],
    );
    assert.deepEqual(counts.get(7), { badSource: 1, killedFromSource: 1 });
  });

  it("reads only the newest `limit` kills, in the server's order", () => {
    const counts = badSourceKillsBySource(
      [{ id: 7, url }],
      [
        row(JSON.stringify([url]), null, 1, "2026-01-01T00:00:00.000Z"),
        row(JSON.stringify([url]), "unreadable", 2, "2026-06-01T00:00:00.000Z"),
      ],
      1,
    );
    assert.deepEqual(counts.get(7), { badSource: 1, killedFromSource: 1 });
  });

  it("leaves out a row with no kill date when the window is full of dated ones", () => {
    const counts = badSourceKillsBySource(
      [{ id: 7, url }],
      [
        row(JSON.stringify([url]), "unreadable", 1),
        row(JSON.stringify([url]), "unreadable", 2, null),
      ],
      1,
    );
    assert.deepEqual(counts.get(7), { badSource: 1, killedFromSource: 1 });
  });

  it("skips a lead that names no source at all, and a source that cannot be an identity", () => {
    assert.equal(
      badSourceKillsBySource([{ id: 7, url }], [row(null, "unreadable", 1), row("not json", "unreadable", 2)])
        .size,
      0,
    );
    assert.equal(
      badSourceKillsBySource([{ id: 7, url: "not a url" }], [row(JSON.stringify(["https://x.example/n"]), "unreadable", 1)])
        .size,
      0,
    );
  });

  it("has nothing to say when the watch list is empty", () => {
    assert.equal(badSourceKillsBySource([], [row(JSON.stringify([url]), "unreadable", 1)]).size, 0);
  });
});


it("keeps unknown and social sources distinct from official records in the preview", () => {
  const rows = previewSources("https://unknown.example/page\nhttps://x.com/council\nhttps://city.gov/records", []).rows;
  assert.notEqual(rows[0]!.kind, rows[2]!.kind);
  assert.notEqual(rows[1]!.kind, rows[2]!.kind);
  assert.notEqual(rows[0]!.kind, rows[1]!.kind);
  assert.equal(sourceKindLabel({ url: "https://unknown.example", title: "", tier: "C", kind: "future-kind" }), rows[0]!.kind);
});
