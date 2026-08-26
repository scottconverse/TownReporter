import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import {
  comparePublishedEvidence,
  loadPublicEvidence,
} from "./evidence.ts";
import { describeTextChanges } from "./retrieve.ts";
import { parseFindings, provenanceFromUrls, resolvePublicFindings } from "./report.ts";

async function ensureArticlesSchema() {
  await ensureInvestigateSchema();
  const sql = await getSql();
  await sql.query(`
    create table if not exists articles (
      id serial primary key,
      user_id text not null,
      lead_id integer,
      slug text not null unique,
      headline text not null,
      dek text not null default '',
      body text not null,
      topic text not null,
      source_urls text not null default '[]',
      status text not null default 'published',
      published_at timestamptz not null default now(),
      provenance_json text not null default '[]',
      form text not null default 'reported',
      found_note text not null default '',
      unanswered text not null default '[]'
    )
  `);
  await sql.query(`alter table articles add column if not exists provenance_json text not null default '[]'`);
  await sql.query(`alter table articles add column if not exists form text not null default 'reported'`);
  await sql.query(`alter table articles add column if not exists found_note text not null default ''`);
  await sql.query(`alter table articles add column if not exists unanswered text not null default '[]'`);
}

describe("public evidence publication", { timeout: 60000 }, () => {
  it("survives draft provenance fields onto a published article and exposes compare", async () => {
    await ensureArticlesSchema();
    const sql = await getSql();
    const user = `pub-${Date.now()}`;
    const url = `https://longmontcolorado.gov/water/report-${Date.now()}.pdf`;
    const v1 = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"aaa"}, ${"August water report"}, ${"The report said construction begins June 1."}, ${"fetched"})
      returning id
    `;
    const v2 = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (${user}, ${url}, ${"bbb"}, ${"August water report"}, ${"The report said construction begins August 31 after a delay."}, ${"fetched"})
      returning id
    `;
    const privateV = await sql<{ id: number }>`
      insert into artifact_versions (user_id, url, content_hash, title, full_text, fetch_outcome)
      values (
        ${user}, ${"https://example.com/private-notes.txt"}, ${"ccc"}, ${"Internal"},
        ${"Do not publish this hypothesis."}, ${"fetched"}
      )
      returning id
    `;
    const provenance = provenanceFromUrls(
      [url],
      [
        {
          url,
          title: "August water report",
          organization: "City of Longmont",
          document_date: "2026-08-01",
          role: "source",
          captured_at: "2026-08-25T12:00:00.000Z",
          version_id: v2[0]!.id,
          version_count: 2,
          disappeared: false,
        },
      ],
    );
    const slug = `group-2-water-${Date.now()}`;
    await sql`
      insert into articles (
        user_id, slug, headline, dek, body, topic, source_urls, status, published_at,
        provenance_json, form, found_note, unanswered
      )
      values (
        ${user}, ${slug}, ${"Group 2 starts Aug. 31"}, ${"A delayed waterline job."},
        ${"Hover Street closures begin August 31."}, ${"utilities"}, ${JSON.stringify([url])},
        ${"published"}, now(), ${JSON.stringify(provenance)}, ${"reported"},
        ${JSON.stringify([{ text: "Packet lists $2.4 million.", source_urls: [url], artifact_version_ids: [v2[0]!.id] }])},
        ${JSON.stringify(["which hydrants"])}
      )
    `;

    const stored = await sql<{
      provenance_json: string;
      found_note: string;
      source_urls: string;
    }>`
      select provenance_json, found_note, source_urls from articles where slug = ${slug} limit 1
    `;
    const kept = JSON.parse(stored[0]!.provenance_json) as typeof provenance;
    assert.equal(kept[0]!.title, "August water report");
    assert.equal(kept[0]!.organization, "City of Longmont");
    assert.equal(kept[0]!.document_date, "2026-08-01");
    assert.equal(kept[0]!.url, url);
    assert.equal(kept[0]!.captured_at, "2026-08-25T12:00:00.000Z");
    assert.equal(kept[0]!.version_id, v2[0]!.id);
    assert.equal(kept[0]!.disappeared, false);

    const pub = await loadPublicEvidence(v2[0]!.id);
    assert.ok(pub);
    assert.equal(pub!.url, url);
    assert.match(pub!.extraction_text, /August 31/);
    assert.match(pub!.content_hash, /bbb/);

    const earlier = await loadPublicEvidence(v1[0]!.id);
    assert.ok(earlier, "other captured versions of a published URL remain readable for compare");

    const hidden = await loadPublicEvidence(privateV[0]!.id);
    assert.equal(hidden, null);

    const compared = await comparePublishedEvidence({ url });
    assert.ok(compared);
    assert.equal(compared!.older.version_id, v1[0]!.id);
    assert.equal(compared!.newer.version_id, v2[0]!.id);
    assert.ok(compared!.changes.added.some((s) => /August 31/.test(s)) || compared!.changes.removed.length > 0);

    const findings = resolvePublicFindings(parseFindings(stored[0]!.found_note), kept);
    assert.equal(findings.length, 1);

    const unbound = resolvePublicFindings(
      parseFindings({ text: "Unsourced allegation.", source_urls: [] }),
      kept,
    );
    assert.equal(unbound.length, 0);

    const diff = describeTextChanges(earlier!.extraction_text, pub!.extraction_text);
    assert.ok(diff.added.length + diff.removed.length > 0);
  });
});
