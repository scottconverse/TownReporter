import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getSql } from "../db.ts";
import {
  searchEvidence,
  clearEvidenceVectorCache,
} from "./evidence-search.server.ts";
import {
  setEmbedderForTests,
  vectorToBytes,
  EVIDENCE_DIMS,
} from "./evidence-embed.server.ts";

/**
 * D285/D286: "Exact words" and "Close in meaning" on the Story page. These run
 * the REAL search against the real (PGlite) `artifact_versions`,
 * `artifact_chunks` and `evidence_vectors` tables with a fake embedder -- the
 * model itself is exercised by `scripts/evidence-meaning-smoke.mjs`, never by
 * this suite.
 */

const NEWSROOM = 811;
const OTHER_ROOM = 812;
let counter = 0;

async function capture(
  url: string,
  title: string,
  capturedAt: string,
  newsroom = NEWSROOM,
): Promise<number> {
  counter += 1;
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into artifact_versions (user_id, url, content_hash, title, captured_at, newsroom_id)
    values (${`scanner-${counter}`}, ${url}, ${`hash-${counter}`}, ${title},
            ${capturedAt}::timestamptz, ${newsroom})
    returning id
  `;
  return row!.id;
}

async function chunk(
  versionId: number,
  excerpt: string,
  newsroom = NEWSROOM,
  index = 0,
): Promise<number> {
  counter += 1;
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into artifact_chunks (version_id, user_id, newsroom_id, chunk_index, excerpt, locator)
    values (${versionId}, ${`scanner-${counter}`}, ${newsroom}, ${index}, ${excerpt}, '')
    returning id
  `;
  return row!.id;
}

async function insertVector(excerpt: string, vector: Float32Array): Promise<void> {
  const sql = await getSql();
  const md5 = createHash("md5").update(excerpt, "utf8").digest("hex");
  await sql`
    insert into evidence_vectors (excerpt_md5, model, dims, vector)
    values (${md5}, 'fake', ${EVIDENCE_DIMS}, ${vectorToBytes(vector)})
    on conflict (excerpt_md5) do update set vector = excluded.vector
  `;
}

/** A 384-length vector from a few leading numbers. */
function vec(...values: number[]): Float32Array {
  const out = new Float32Array(EVIDENCE_DIMS);
  values.forEach((v, i) => {
    out[i] = v;
  });
  return out;
}

function fakeEmbedder(map: Record<string, Float32Array>) {
  return async (texts: string[]): Promise<Float32Array[]> =>
    texts.map((text) => {
      const vector = map[text];
      if (!vector) throw new Error(`no fake vector for ${text}`);
      return vector;
    });
}

afterEach(() => {
  setEmbedderForTests(null);
  clearEvidenceVectorCache();
});

describe("searchEvidence: exact words", () => {
  it("returns only the piece that holds the words", async () => {
    const v = await capture("https://example.com/one", "One", "2026-10-01T10:00:00Z");
    await chunk(v, "The council approved the broadband plan.", NEWSROOM, 0);
    await chunk(v, "A separate paragraph about water rates.", NEWSROOM, 1);
    const v2 = await capture("https://example.com/two", "Two", "2026-10-02T10:00:00Z");
    await chunk(v2, "Road work closes Main Street.", NEWSROOM, 0);

    setEmbedderForTests(fakeEmbedder({ broadband: vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "broadband");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.equal(result.exact[0]!.url, "https://example.com/one");
  });

  it("treats % as a literal character", async () => {
    const v = await capture("https://example.com/pct", "Pct", "2026-10-01T10:00:00Z");
    await chunk(v, "The bond is 100% funded.", NEWSROOM, 0);
    await chunk(v, "About 1000 homes are covered.", NEWSROOM, 1);

    setEmbedderForTests(fakeEmbedder({ "100%": vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "100%");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.match(result.exact[0]!.excerptStart, /100% funded/);
  });

  it("collapses the same excerpt in two captures to the newest one", async () => {
    const old = await capture("https://example.com/old", "Old copy", "2026-09-01T10:00:00Z");
    await chunk(old, "Repeated passage about the reservoir.");
    const newer = await capture("https://example.com/new", "New copy", "2026-10-05T10:00:00Z");
    await chunk(newer, "Repeated passage about the reservoir.");

    setEmbedderForTests(fakeEmbedder({ reservoir: vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "reservoir");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.equal(result.exact[0]!.url, "https://example.com/new");
    assert.equal(result.exact[0]!.title, "New copy");
  });

  it("lists 30 distinct pieces, newest first, and still finds old pieces behind many copies of one (G24-S3-2)", async () => {
    // 610 recent copies of ONE excerpt would fill a short read of the newest
    // rows; the three older distinct pieces behind them must still be listed,
    // each once, newest copy first.
    const room = 813;
    for (let i = 0; i < 610; i += 1) {
      const copy = await capture(`https://example.com/dup-${i}`, `Dup ${i}`, "2026-10-10T10:00:00Z", room);
      await chunk(copy, "Zebra crossing repainted on Third Street.", room, 0);
    }
    for (let i = 0; i < 3; i += 1) {
      const older = await capture(`https://example.com/old-${i}`, `Older ${i}`, `2026-09-0${i + 1}T10:00:00Z`, room);
      await chunk(older, `Zebra herd number ${i} counted at the park.`, room, 0);
    }
    setEmbedderForTests(fakeEmbedder({ zebra: vec(1) }));
    const result = await searchEvidence({ newsroomId: room }, "zebra");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 4);
    assert.match(result.exact[0]!.excerptStart, /Zebra crossing/);
    assert.deepEqual(result.exact.slice(1).map((row) => row.title), ["Older 2", "Older 1", "Older 0"]);

    // And more than 30 distinct pieces: exactly 30, the newest ones.
    const wide = 814;
    for (let i = 0; i < 35; i += 1) {
      const v = await capture(`https://example.com/wide-${i}`, `Wide ${i}`, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), wide);
      await chunk(v, `Giraffe sighting number ${i}.`, wide, 0);
    }
    setEmbedderForTests(fakeEmbedder({ giraffe: vec(1) }));
    const many = await searchEvidence({ newsroomId: wide }, "giraffe");
    assert.equal(many.ok, true);
    if (!many.ok) return;
    assert.equal(many.exact.length, 30);
    assert.equal(many.exact[0]!.title, "Wide 34");
    assert.equal(many.exact[29]!.title, "Wide 5");
  });

  it("never shows a blank excerpt", async () => {
    const v = await capture("https://example.com/blank", "Blank", "2026-10-01T10:00:00Z");
    await chunk(v, "");

    setEmbedderForTests(fakeEmbedder({ blanked: vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "blanked");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 0);
  });

  it("never shows another newsroom's piece", async () => {
    const mine = await capture("https://example.com/mine", "Mine", "2026-10-01T10:00:00Z");
    await chunk(mine, "Zoning change for the north parcel.");
    const theirs = await capture(
      "https://example.com/theirs",
      "Theirs",
      "2026-10-01T10:00:00Z",
      OTHER_ROOM,
    );
    await chunk(theirs, "Zoning change somewhere else.", OTHER_ROOM);

    setEmbedderForTests(fakeEmbedder({ zoning: vec(1) }));
    const result = await searchEvidence({ newsroomId: NEWSROOM }, "zoning");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.equal(result.exact[0]!.url, "https://example.com/mine");
  });

  it("refuses an empty or overlong query", async () => {
    const empty = await searchEvidence({ newsroomId: NEWSROOM }, "   ");
    assert.equal(empty.ok, false);
    if (empty.ok) return;
    assert.equal(empty.error, "Type a few words to search.");
    const long = await searchEvidence({ newsroomId: NEWSROOM }, "x".repeat(201));
    assert.equal(long.ok, false);
  });
});

describe("searchEvidence: broken text", () => {
  // D288: a piece is broken when 2% or more of its characters are control
  // bytes or U+FFFD. Broken pieces are hidden from both lists and from the
  // coverage count.
  const brokenPiece = "Budget recovery " + "\u0003".repeat(10) + "plan";

  it("hides a broken piece from both lists and the count", async () => {
    const v = await capture("https://example.com/broken", "Broken", "2026-10-01T10:00:00Z");
    const clean = "Budget recovery plan for the water fund";
    await chunk(v, brokenPiece);
    await chunk(v, clean);
    // Both have vectors; the meaning list must still refuse the broken one.
    // Scores kept below the later tests' own pieces so this file's ordering
    // assertions stay about those pieces.
    await insertVector(brokenPiece, vec(0.4, 0.6));
    await insertVector(clean, vec(0.5, 0.5));
    setEmbedderForTests(fakeEmbedder({ recovery: vec(1, 0) }));

    const result = await searchEvidence({ newsroomId: NEWSROOM }, "recovery");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.exact.map((row) => row.excerptStart), [clean]);
    // The clean piece is already on the exact list, so the meaning list must
    // have nothing left -- and never the broken piece.
    assert.ok(result.meaning.every((row) => row.excerptStart !== brokenPiece));

    // `total` is every distinct non-blank excerpt in this newsroom that is not
    // broken, computed here independently of the SQL under test.
    const sql = await getSql();
    const stored = await sql<{ excerpt: string }>`
      select distinct excerpt from artifact_chunks
      where newsroom_id = ${NEWSROOM} and excerpt <> ''
    `;
    // Broken = C0 controls except tab/newline/form feed/return, or U+FFFD.
    const isBrokenChar = (ch: string): boolean => {
      const code = ch.codePointAt(0) ?? 0;
      return (
        (code >= 0x01 && code <= 0x08) ||
        code === 0x0b ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0xfffd
      );
    };
    const expectedTotal = stored.filter((row) => {
      const count = [...row.excerpt].filter(isBrokenChar).length;
      return count < 0.02 * row.excerpt.length;
    }).length;
    assert.equal(result.meaningStatus.total, expectedTotal);
  });

  it("does not treat tabs, newlines or a form feed as broken", async () => {
    const v = await capture("https://example.com/white", "White", "2026-10-01T10:00:00Z");
    const clean = "First line of form feed\twith a tab\nand a newline\r\nand a form feed\fend";
    await chunk(v, clean);
    setEmbedderForTests(fakeEmbedder({ "form feed": vec(1, 0) }));

    const result = await searchEvidence({ newsroomId: NEWSROOM }, "form feed");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.exact.map((row) => row.excerptStart), [clean]);
  });
});

describe("searchEvidence: close in meaning", () => {
  it("puts the nearest piece first, at most five, and never repeats an exact hit", async () => {
    const v = await capture("https://example.com/city", "City internet", "2026-10-01T10:00:00Z");
    const queryText = "city internet";
    const nearest = "NextLight broadband service for Longmont homes";
    const second = "Municipal fiber reaches more neighborhoods";
    const exactPiece = "city internet plan advances";
    await chunk(v, queryText);
    await chunk(v, nearest);
    await chunk(v, second);
    await chunk(v, exactPiece);
    for (let i = 0; i < 6; i += 1) {
      await chunk(v, `Unrelated piece number ${i} about sewer rates`);
    }
    await insertVector(queryText, vec(1, 0));
    await insertVector(nearest, vec(0.9, 0.1));
    await insertVector(second, vec(0.8, 0.2));
    await insertVector(exactPiece, vec(0.95, 0.05));
    for (let i = 0; i < 6; i += 1) {
      await insertVector(`Unrelated piece number ${i} about sewer rates`, vec(0, 1));
    }
    setEmbedderForTests(fakeEmbedder({ [queryText]: vec(1, 0) }));

    const result = await searchEvidence({ newsroomId: NEWSROOM }, queryText);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.exact.length >= 1, "the literal words are on the left");
    assert.ok(result.exact.some((row) => row.excerptStart === exactPiece));
    assert.equal(result.meaning.length, 5, "never more than five");
    assert.equal(result.meaning[0]!.excerptStart, nearest, "nearest by meaning comes first");
    assert.ok(
      result.meaning.every((row) => !result.exact.some((exact) => exact.md5 === row.md5)),
      "no piece repeats across the two lists",
    );
    assert.equal(result.meaningStatus.ready, true);
  });

  it("drops a piece once its excerpt is blanked (what a takedown does)", async () => {
    const v = await capture("https://example.com/gone", "Gone", "2026-10-01T10:00:00Z");
    const kept = "Water treatment plant upgrade approved";
    const takenDown = "Water treatment plant contract details";
    await chunk(v, kept);
    const hit = await chunk(v, takenDown);
    // Higher than the earlier tests' pieces (which share this newsroom), so
    // this test's own two rows are the ones at the top of the list.
    await insertVector(kept, vec(2, 0));
    await insertVector(takenDown, vec(3, 0));
    setEmbedderForTests(fakeEmbedder({ "water plant": vec(1, 0) }));

    const first = await searchEvidence({ newsroomId: NEWSROOM }, "water plant");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.meaning[0]!.excerptStart, takenDown);

    const sql = await getSql();
    await sql`update artifact_chunks set excerpt = '' where id = ${hit}`;
    const next = await searchEvidence({ newsroomId: NEWSROOM }, "water plant");
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.ok(next.meaning.every((row) => row.excerptStart !== takenDown));
    assert.equal(next.meaning[0]!.excerptStart, kept);
  });

  it("counts covered and total evidence pieces", async () => {
    const v = await capture("https://example.com/counts", "Counts", "2026-10-01T10:00:00Z");
    await chunk(v, "Counted piece one");
    await chunk(v, "Counted piece two");
    await chunk(v, "");
    await insertVector("Counted piece one", vec(1, 0));
    setEmbedderForTests(fakeEmbedder({ counts: vec(1, 0) }));

    const result = await searchEvidence({ newsroomId: NEWSROOM }, "counts");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // This test's own two pieces plus everything the earlier tests in this file
    // filed in NEWSROOM: covered counts vectors that match a live excerpt.
    assert.ok(result.meaningStatus.total >= 2);
    assert.ok(result.meaningStatus.covered >= 1);
    assert.ok(result.meaningStatus.covered <= result.meaningStatus.total);
  });

  it("keeps the exact list when the meaning model throws", async () => {
    const v = await capture("https://example.com/model", "Model", "2026-10-01T10:00:00Z");
    await chunk(v, "Emergency shelter opens tonight.");
    setEmbedderForTests(async () => {
      throw new Error("the model could not load");
    });

    const result = await searchEvidence({ newsroomId: NEWSROOM }, "shelter");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exact.length, 1);
    assert.equal(result.meaning.length, 0);
    assert.equal(result.meaningStatus.ready, false);
    assert.match(result.meaningStatus.reason ?? "", /model could not load/);
  });
});

describe("searchEvidence: the caller's pieces only", () => {
  it("ranks this newsroom's pieces even when another paper's pieces score higher", async () => {
    const ROOM = 813;
    const other = await capture("https://example.com/other-paper", "Other paper", "2026-10-01T10:00:00Z", OTHER_ROOM);
    // Seventy pieces from the other paper, all closer to the query than ours.
    // The old candidate cut (the top 60 across every paper) keeps only these.
    for (let i = 0; i < 70; i += 1) {
      const text = `Other paper report ${i} on the flood barrier`;
      await chunk(other, text, OTHER_ROOM, i);
      await insertVector(text, vec(1, 0));
    }
    const mine = await capture("https://example.com/ours", "Ours", "2026-10-01T10:00:00Z", ROOM);
    const ours = "Harbor levee repair bids opened Monday";
    await chunk(mine, ours, ROOM, 0);
    await insertVector(ours, vec(0.9, 0.1));
    setEmbedderForTests(fakeEmbedder({ "flood gates": vec(1, 0) }));

    const result = await searchEvidence({ newsroomId: ROOM }, "flood gates");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.exact, []);
    assert.deepEqual(result.meaning.map((row) => row.excerptStart), [ours]);
  });
});

describe("searchEvidence: weak meaning matches are hidden", () => {
  it("shows no meaning rows for nonsense, and still shows a real match", async () => {
    const ROOM = 814;
    const v = await capture("https://example.com/weak", "Weak", "2026-10-01T10:00:00Z", ROOM);
    const parking = "Parking meter schedule for the depot lot";
    const sidewalk = "Annual report on sidewalk maintenance";
    const water = "Water rates rise for homes in the north district";
    await chunk(v, parking, ROOM, 0);
    await chunk(v, sidewalk, ROOM, 1);
    await chunk(v, water, ROOM, 2);
    // Nonsense scores 0.30 and 0.27 on the first two (weak, below the floor) and
    // 0 on the third. Only two vectors from earlier tests score higher, so
    // without a floor both weak pieces make the top-60 cut and reach the list.
    await insertVector(parking, vec(0, 0, 1));
    await insertVector(sidewalk, vec(0, 0, 0.9));
    await insertVector(water, vec(0, 0, 0, 1));
    setEmbedderForTests(
      fakeEmbedder({
        "zqxjvwk nohitword": vec(0.2, 0, 0.3),
        "utility bills": vec(0, 0, 0, 1),
      }),
    );

    const nonsense = await searchEvidence({ newsroomId: ROOM }, "zqxjvwk nohitword");
    assert.equal(nonsense.ok, true);
    if (!nonsense.ok) return;
    assert.deepEqual(nonsense.exact, []);
    assert.deepEqual(nonsense.meaning, [], "weak matches below the floor are hidden");
    assert.equal(nonsense.meaningStatus.ready, true);

    const real = await searchEvidence({ newsroomId: ROOM }, "utility bills");
    assert.equal(real.ok, true);
    if (!real.ok) return;
    assert.ok(real.meaning.length >= 1, "a real query still gets its meaning list");
    assert.equal(real.meaning[0]!.excerptStart, water, "the closest piece comes first");
  });
});

describe("searchEvidence: coverage line", () => {
  it("reuses the count on repeat use and shows new pieces within about a minute", async () => {
    const ROOM = 815;
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    try {
      const v = await capture("https://example.com/cover", "Cover", "2026-10-01T10:00:00Z", ROOM);
      await chunk(v, "Coverage piece one for the budget", ROOM, 0);
      setEmbedderForTests(fakeEmbedder({ budget: vec(1) }));
      const first = await searchEvidence({ newsroomId: ROOM }, "budget");
      assert.equal(first.ok, true);
      if (!first.ok) return;
      assert.equal(first.meaningStatus.total, 1);

      await chunk(v, "Coverage piece two for the budget", ROOM, 1);
      mock.timers.tick(10_000);
      const repeat = await searchEvidence({ newsroomId: ROOM }, "budget");
      assert.equal(repeat.ok, true);
      if (!repeat.ok) return;
      assert.equal(repeat.meaningStatus.total, 1, "a repeat search within seconds reuses the count");

      mock.timers.tick(60_000);
      const later = await searchEvidence({ newsroomId: ROOM }, "budget");
      assert.equal(later.ok, true);
      if (!later.ok) return;
      assert.equal(later.meaningStatus.total, 2, "a minute later the count is true again");
    } finally {
      mock.timers.reset();
    }
  });
});
