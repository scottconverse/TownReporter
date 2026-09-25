import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  captureCitedPages,
  importInputSha256,
  performImportFinishedStories,
  readImportStructure,
  verifySelections,
  type ImportSelection,
} from "./import-stories.server.ts";
import { splitParagraphs } from "./import-stories.ts";

/**
 * A paste with no headings at all, so nothing here is read deterministically --
 * these are the texts the structure-only model call exists for.
 */
const MESSY = [
  "The council put off its decision on the Ride Longmont expansion until October 6.",
  "Two members said they wanted the ridership figures first.",
  "The city budget office said the transit line costs $4 million a year to run.",
].join("\n\n");

const SELECTION: ImportSelection = {
  headline: "Council delays the transit vote",
  section: "council",
  dek: "",
  body: [splitParagraphs(MESSY)[0]!, splitParagraphs(MESSY)[1]!].join("\n\n"),
  links: [],
  score: "",
  triage: "",
  reporterNextStep: "",
  hold: false,
  disclosureKey: "person",
  disclosureOther: "",
};

describe("readImportStructure: one model call, structure only", () => {
  it("accepts a split whose every paragraph is copied from the paste", async () => {
    const result = await readImportStructure(
      { text: MESSY, newsroomId: 91, modelChoice: "claude-sonnet" },
      {
        chat: async () => ({
          ok: true,
          text: JSON.stringify({
            stories: [
              {
                headline: "Transit vote delayed",
                body: [splitParagraphs(MESSY)[0]!, splitParagraphs(MESSY)[1]!],
              },
              { headline: "What it costs", body: [splitParagraphs(MESSY)[2]!] },
            ],
          }),
        }),
      },
    );
    assert.equal(result.method, "model");
    assert.equal(result.stories.length, 2);
    assert.equal(result.stories[1]!.body, splitParagraphs(MESSY)[2]!);
    assert.equal(result.rejected, 0);
  });

  it("rejects a split that alters a sentence, and hands back the paste unchanged instead", async () => {
    const result = await readImportStructure(
      { text: MESSY, newsroomId: 91, modelChoice: "claude-sonnet" },
      {
        chat: async () => ({
          ok: true,
          text: JSON.stringify({
            stories: [
              { headline: "Transit", body: ["The council delayed the vote until October 6."] },
            ],
          }),
        }),
      },
    );
    assert.equal(result.method, "fallback");
    assert.equal(result.rejected, 1);
    assert.match(result.reason, /not in your text/);
    assert.equal(result.stories.length, 1);
    assert.equal(result.stories[0]!.cleanSplit, false);
    assert.match(result.stories[0]!.warning, /Could not split this cleanly/);
    // The model's invented sentence is nowhere in what the desk was handed.
    assert.equal(result.stories[0]!.body.includes("delayed the vote"), false);
    assert.equal(result.stories[0]!.body, MESSY);
  });

  it("flags a model that found nothing rather than filing an empty desk", async () => {
    const result = await readImportStructure(
      { text: MESSY, newsroomId: 91, modelChoice: "claude-sonnet" },
      { chat: async () => ({ ok: true, text: '{"stories":[]}' }) },
    );
    assert.equal(result.method, "fallback");
    assert.equal(result.stories.length, 1);
    assert.equal(result.stories[0]!.cleanSplit, false);
  });

  it("keeps the paste intact when the provider itself fails", async () => {
    const result = await readImportStructure(
      { text: MESSY, newsroomId: 91, modelChoice: "claude-sonnet" },
      {
        chat: async () => ({ ok: false, error: "Claude Code sign-in has lapsed" }),
        probe: async () => ({ ok: false, error: "not ready" }),
      },
    );
    assert.match(result.error, /sign-in has lapsed/);
    assert.equal(result.stories[0]!.body, MESSY);
  });

  it("does not call a model at all when there is nothing to read", async () => {
    let calls = 0;
    const result = await readImportStructure(
      { text: "   \n  ", newsroomId: 91 },
      {
        chat: async () => {
          calls += 1;
          return { ok: true, text: "{}" };
        },
      },
    );
    assert.equal(calls, 0);
    assert.match(result.error, /no text to read/i);
    assert.deepEqual(result.stories, []);
  });
});

describe("verifySelections: the paste is the only source of text", () => {
  it("accepts a card whose body and dek are word for word in the paste", () => {
    const { accepted, refused } = verifySelections(MESSY, [
      { ...SELECTION, dek: splitParagraphs(MESSY)[2]! },
    ]);
    assert.equal(refused.length, 0);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0]!.body, SELECTION.body);
  });

  it("refuses a card carrying a sentence the editor never pasted, and says which", () => {
    const { accepted, refused } = verifySelections(MESSY, [
      { ...SELECTION, body: `${SELECTION.body}\n\nStaff expect a vote in November.` },
    ]);
    assert.equal(accepted.length, 0);
    assert.equal(refused.length, 1);
    assert.equal(refused[0]!.headline, "Council delays the transit vote");
    assert.match(refused[0]!.reason, /not word-for-word what you pasted/);
    assert.match(refused[0]!.reason, /Staff expect a vote in November/);
  });

  it("refuses a card with no headline or no text", () => {
    const { accepted, refused } = verifySelections(MESSY, [
      { ...SELECTION, headline: "  " },
      { ...SELECTION, body: "" },
    ]);
    assert.equal(accepted.length, 0);
    assert.deepEqual(
      refused.map((r) => r.reason),
      ["Give it a headline first.", "This story has no text."],
    );
  });
});

describe("importInputSha256", () => {
  it("is a stable 64-character digest of exactly the text that arrived", () => {
    const a = importInputSha256(MESSY);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(importInputSha256(MESSY), a);
    assert.notEqual(importInputSha256(`${MESSY} `), a);
  });
});

/* --- the write path, against a real PGlite database ------------------- */

const PASTE = [
  "### 1. Council delays the transit vote",
  "",
  splitParagraphs(MESSY)[0]!,
  "",
  splitParagraphs(MESSY)[1]!,
  "",
  "**Why it matters:** The expansion decision now waits for ridership data.",
  "",
  "[council packet](https://longmont.primegov.com/packet)",
  "",
  "### 2. St. Vrain board packet presents assessment results",
  "",
  splitParagraphs(MESSY)[2]!,
  "",
  "**Score:** 9/20 · **Hold**",
].join("\n");

const PASTE_PARAGRAPHS = splitParagraphs(PASTE);

async function ensureSchema() {
  const sql = await getSql();
  await sql.query(`create table if not exists leads (id serial primary key, newsroom_id integer not null,
    user_id text not null, scan_run_id integer, headline text, why text, topic text default 'council',
    status text default 'new', source_urls text default '[]', evidence text, newsworthiness integer default 0,
    created_at timestamptz default now(), investigation_id integer, notes_json text, origin text, provenance_json text)`);
  await sql.query(`create table if not exists drafts (id serial primary key, newsroom_id integer, user_id text,
    lead_id integer, headline text, dek text default '', body text not null, topic text not null,
    source_urls text default '[]', provenance_json text default '[]', disclosure_text text not null default '',
    updated_at timestamptz default now())`);
  await sql.query(`create table if not exists articles (id serial primary key, newsroom_id integer)`);
  return sql;
}

const CARD = {
  headline: "Council delays the transit vote",
  section: "council",
  dek: "The expansion decision now waits for ridership data.",
  body: `${PASTE_PARAGRAPHS[1]!}\n\n${PASTE_PARAGRAPHS[2]!}`,
  links: [{ text: "council packet", url: "https://longmont.primegov.com/packet" }],
  score: "17/20",
  triage: "Advance",
  reporterNextStep: "Ask the transit office for the ridership figures.",
  hold: false,
  disclosureKey: "outside-ai" as const,
  disclosureOther: "",
};

const HOLD_CARD = {
  headline: "St. Vrain board packet presents assessment results",
  section: "schools",
  dek: "",
  body: PASTE_PARAGRAPHS[3]!,
  links: [],
  score: "9/20",
  triage: "Hold",
  reporterNextStep: "",
  hold: true,
  disclosureKey: "outside-ai" as const,
  disclosureOther: "",
};

describe("performImportFinishedStories: leads and drafts in the Queue", () => {
  it("files one lead and one saved draft per ticked card, and publishes nothing", async () => {
    const sql = await ensureSchema();
    const seen: { url: string; leadId: number }[] = [];
    const result = await performImportFinishedStories(
      { userId: "editor", newsroomId: 91 },
      { text: PASTE, tool: "Civic Source Scanner", stories: [CARD, HOLD_CARD] },
      {
        capture: async (_ctx, targets) => {
          seen.push(...targets.map((t) => ({ url: t.url, leadId: t.leadId })));
          return { captured: targets.length, failed: 0 };
        },
      },
    );
    assert.equal(result.error, "");
    assert.deepEqual(result.imported.map((i) => i.hold), [false, true]);

    const leads = await sql.query(
      "select id, headline, status, origin, provenance_json, source_urls from leads where newsroom_id=91 order by id",
    ) as {
      id: number;
      headline: string;
      status: string;
      origin: string;
      provenance_json: string;
      source_urls: string;
    }[];
    assert.equal(leads.length, 2);
    assert.equal(leads[0]!.origin, "import");
    assert.equal(leads[0]!.headline, CARD.headline);
    assert.equal(leads[0]!.status, "new");
    // A "Hold" triage imports with a visible Hold flag.
    assert.equal(leads[1]!.status, "held");
    assert.equal(leads[1]!.headline, HOLD_CARD.headline);

    const provenance = JSON.parse(leads[0]!.provenance_json!) as Record<string, unknown>;
    assert.equal(provenance.importer, "editor");
    assert.equal(provenance.tool, "Civic Source Scanner");
    assert.equal(provenance.inputSha256, importInputSha256(PASTE));
    assert.match(String(provenance.importedAt), /^\d{4}-\d{2}-\d{2}T/);

    const drafts = await sql.query(
      "select lead_id, headline, dek, body, topic, source_urls, disclosure_text from drafts where newsroom_id=91 order by id",
    ) as {
      lead_id: number;
      headline: string;
      dek: string;
      body: string;
      topic: string;
      source_urls: string;
      disclosure_text: string;
    }[];
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0]!.lead_id, leads[0]!.id);
    // The body is the paste's own paragraphs, byte for byte.
    assert.equal(drafts[0]!.body, CARD.body);
    assert.equal(drafts[1]!.body, HOLD_CARD.body);
    assert.equal(drafts[0]!.topic, "council");
    assert.equal(drafts[1]!.topic, "schools");
    assert.deepEqual(JSON.parse(drafts[0]!.source_urls), ["https://longmont.primegov.com/packet"]);
    assert.equal(
      drafts[0]!.disclosure_text,
      "An outside AI research tool wrote this from public records; an editor reviewed it.",
    );

    // Nothing publishes: an imported story leaves the desk only via Publish.
    const [published] = await sql.query("select count(*)::int as n from articles") as { n: number }[];
    assert.equal(published!.n, 0);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.leadId, leads[0]!.id);
  });

  it("refuses an altered card and files nothing for it", async () => {
    const sql = await ensureSchema();
    const [before] = await sql.query("select count(*)::int as n from leads") as { n: number }[];
    const result = await performImportFinishedStories(
      { userId: "editor", newsroomId: 92 },
      {
        text: PASTE,
        tool: "",
        stories: [{ ...CARD, body: `${CARD.body}\n\nThe vote was unanimous.` }],
      },
      { capture: async () => ({ captured: 0, failed: 0 }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.imported.length, 0);
    assert.equal(result.refused.length, 1);
    assert.match(result.error, /not word-for-word what you pasted/);
    const [after] = await sql.query("select count(*)::int as n from leads") as { n: number }[];
    assert.equal(after!.n, before!.n);
  });

  it("refuses an empty paste without writing anything", async () => {
    const sql = await ensureSchema();
    const [before] = await sql.query("select count(*)::int as n from drafts") as { n: number }[];
    const result = await performImportFinishedStories({ userId: "editor", newsroomId: 93 }, {
      text: "",
      tool: "",
      stories: [CARD],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /no text to import/i);
    const [after] = await sql.query("select count(*)::int as n from drafts") as { n: number }[];
    assert.equal(after!.n, before!.n);
  });
});

describe("captureCitedPages: the existing capture path, best effort", () => {
  it("stores a fetched page against the lead, and leaves no document for a page that would not load", async () => {
    const sql = await ensureSchema();
    const [lead] = await sql.query(
      "insert into leads (newsroom_id,user_id,headline,origin) values (94,'editor','Cited', 'import') returning id",
    ) as { id: number }[];
    const result = await captureCitedPages(
      { userId: "editor", newsroomId: 94 },
      [
        { url: "https://example.test/ok", headline: "Cited", leadId: lead!.id },
        { url: "https://example.test/dead", headline: "Cited", leadId: lead!.id },
      ],
      {
        ingest: async (url) =>
          url.endsWith("/ok")
            ? {
                ok: true,
                status: 200,
                outcome: "fetched",
                text: "The packet says the line costs $4 million a year to run.",
                title: "Council packet",
                extras: [],
                contentType: "text/html",
                needsOcr: false,
                needsOcrReason: "",
                redirectChain: [],
                extractionMethod: "html",
                pages: [],
                notices: [],
                rawBytes: undefined,
              }
            : {
                ok: false,
                status: 404,
                outcome: "fetch-failed",
                text: "",
                title: "",
                extras: [],
                contentType: "",
                needsOcr: false,
                needsOcrReason: "the page did not load",
                redirectChain: [],
                extractionMethod: "",
                pages: [],
                notices: [],
                rawBytes: undefined,
              },
      },
    );
    assert.deepEqual(result, { captured: 1, failed: 1 });
    const docs = await sql.query(
      "select lead_id, filename, original, full_text, status, source_url from story_documents where newsroom_id=94 order by source_url",
    ) as {
      lead_id: number | null;
      filename: string;
      original: Uint8Array;
      full_text: string | null;
      status: string;
      source_url: string;
    }[];
    // The page that loaded is a document on the lead; the page that did not
    // leaves no row at all -- no bytes, no document.
    assert.deepEqual(
      docs.map((d) => d.source_url),
      ["https://example.test/ok"],
    );
    assert.equal(docs[0]!.lead_id, lead!.id);
    assert.equal(docs[0]!.filename, "Council packet.txt");
    // Captured, not yet read: the ordinary document reading still has to run,
    // so the row does not claim to have been read.
    assert.equal(docs[0]!.status, "uploaded");
    assert.equal(docs[0]!.full_text, null);
    const stored = Buffer.from(docs[0]!.original).toString("utf8");
    assert.match(stored, /^SOURCE URL: https:\/\/example\.test\/ok\n/);
    assert.match(stored, /costs \$4 million a year/);
  });
});
