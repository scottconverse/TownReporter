import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import { extractPdfBetter } from "./ingest.ts";
import {
  emptyPlan,
  ensureInvestigateSchema,
  evidenceAppearsInText,
  findEvidenceChunks,
  rememberCapture,
  researchLoop,
  retrievePack,
  runDueMonitors,
  seedInvestigation,
  watchSource,
  type FetchFn,
  type HopPlan,
} from "./investigate.ts";
import { sha256 } from "./fetch-url.ts";

async function bootInv(user: string, title: string) {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title) values (${user}, ${title}) returning id
  `;
  return { sql, id: rows[0]!.id };
}

const fetchOk = (text: string, title: string, extras: string[] = []): Awaited<ReturnType<FetchFn>> => ({
  ok: true,
  status: 200,
  text,
  title,
  extras,
});

describe("quote in document", () => {
  it("does not treat a paraphrase or a short string as a quote", () => {
    const body = "Packet A awards a sidewalk contract to Civic Paving LLC.";
    assert.equal(evidenceAppearsInText("Packet A awards a sidewalk contract to Civic Paving LLC.", body), true);
    assert.equal(evidenceAppearsInText("Packet A awards the contract", body), false);
    assert.equal(evidenceAppearsInText("no locator", body), false);
  });
});

describe("forensic chronology", { timeout: 120000 }, () => {
  it("keeps A→B→A→B→missing→restored as capture events while versions stay unique", async () => {
    const user = `forensic-chrono-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Chronology");
    const url = "https://longmontcolorado.gov/water/water-quality-report.html";
    const A = "Water quality report version A. Nitrate 0.4 mg/L. ".repeat(6);
    const B = "Water quality report version B. Nitrate 0.9 mg/L. ".repeat(6);
    const C = "Water quality report version C after restoration. Nitrate 0.3 mg/L. ".repeat(6);
    const live = {
      body: fetchOk(A, "Water Quality Report"),
    };
    const run = async () =>
      researchLoop({
        userId: user,
        investigationId: id,
        hops: 1,
        search: async () => [],
        fetch: async () => live.body,
        planner: async () => {
          const p = emptyPlan();
          p.fetch_urls = [url];
          p.summary = "recheck water report";
          return p;
        },
        archives: async () => [],
      });

    await run();
    live.body = fetchOk(B, "Water Quality Report");
    await run();
    live.body = fetchOk(A, "Water Quality Report");
    await run();
    live.body = fetchOk(B, "Water Quality Report");
    await run();
    live.body = { ok: false, status: 404, text: "", title: "Not Found", extras: [] };
    await run();
    live.body = fetchOk(C, "Water Quality Report");
    await run();

    const canon = canonicalPublicUrl(url);
    const events = await sql<{
      fetch_outcome: string;
      content_hash: string | null;
      version_id: number | null;
      http_status: number | null;
    }>`
      select fetch_outcome, content_hash, version_id, http_status
      from capture_events
      where user_id = ${user} and source_url = ${canon}
      order by id asc
    `;
    assert.ok(events.length >= 6, `expected 6 observations, got ${events.length}`);
    const hashA = await sha256(A);
    const hashB = await sha256(B);
    const hashC = await sha256(C);
    assert.equal(events[0]!.content_hash, hashA);
    assert.equal(events[1]!.content_hash, hashB);
    assert.equal(events[2]!.content_hash, hashA);
    assert.equal(events[3]!.content_hash, hashB);
    assert.ok(
      events[4]!.fetch_outcome === "removed" || events[4]!.http_status === 404 || events[4]!.content_hash === "missing",
      JSON.stringify(events[4]),
    );
    assert.equal(events[5]!.content_hash, hashC);
    assert.equal(events[0]!.version_id, events[2]!.version_id);
    assert.equal(events[1]!.version_id, events[3]!.version_id);
    assert.notEqual(events[0]!.version_id, events[1]!.version_id);

    const versions = await sql<{ id: number; content_hash: string }>`
      select id, content_hash from artifact_versions where user_id = ${user} and url = ${canon}
    `;
    const uniqueHashes = new Set(versions.map((v) => v.content_hash));
    assert.ok(uniqueHashes.has(hashA) && uniqueHashes.has(hashB) && uniqueHashes.has(hashC));
    assert.ok(versions.length < events.length, "version dedupe must not destroy chronology");
  });
});

describe("exact provenance", { timeout: 120000 }, () => {
  it("binds claims and relationships to the cited artifact, never last-fetched", async () => {
    const user = `forensic-prov-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Provenance");
    const URL_A = "https://longmontcolorado.gov/agendas/packet-a.html";
    const URL_B = "https://records.bouldercolorado.gov/contracts/packet-b.pdf";
    const bodyA = "Packet A awards a sidewalk contract to Civic Paving LLC. ".repeat(4);
    const bodyB = "Packet B names Jane Roe as registered agent for Civic Paving LLC. ".repeat(4);
    let hop = 0;
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 2,
      search: async () => [],
      fetch: async (url) => {
        if (url.includes("packet-a")) return fetchOk(bodyA, "Packet A");
        if (url.includes("packet-b")) return fetchOk(bodyB, "Packet B");
        return { ok: false, status: 404, text: "", title: "Not Found", extras: [] };
      },
      planner: async () => {
        hop += 1;
        const p = emptyPlan();
        if (hop === 1) {
          p.fetch_urls = [URL_A];
          p.claims.push({
            text: "Civic Paving won the sidewalk contract",
            kind: "FACT",
            evidence: "Packet A awards a sidewalk contract to Civic Paving LLC.",
            source_url: URL_A,
          });
          p.relationships.push({
            from: "City of Longmont",
            to: "Civic Paving LLC",
            kind: "contract",
            evidence: "Packet A awards a sidewalk contract",
            source_url: URL_A,
          });
          p.summary = "fetch A";
        } else {
          p.fetch_urls = [URL_B];
          p.claims.push({
            text: "Jane Roe is registered agent",
            kind: "FACT",
            evidence: "Packet B names Jane Roe as registered agent for Civic Paving LLC.",
            source_url: URL_B,
          });
          p.claims.push({
            text: "Something inferred with no supporting document",
            kind: "INFERENCE",
            evidence: "no locator",
          });
          p.claims.push({
            text: "A quote the model invented",
            kind: "FACT",
            evidence: "The mayor secretly sold the water plant to a holding company.",
            source_url: URL_A,
          });
          p.claims.push({
            text: "Cited the packet with no quote",
            kind: "FACT",
            evidence: "",
            source_url: URL_A,
          });
          p.relationships.push({
            from: "Civic Paving LLC",
            to: "Jane Roe",
            kind: "agent",
            evidence: "Jane Roe as registered agent for Civic Paving LLC.",
            source_url: URL_B,
          });
          p.summary = "fetch B";
        }
        return p;
      },
      archives: async () => [],
    });

    const versions = await sql<{ id: number; url: string; content_hash: string }>`
      select id, url, content_hash from artifact_versions where user_id = ${user} order by id
    `;
    const verA = versions.find((v) => v.url.includes("packet-a"));
    const verB = versions.find((v) => v.url.includes("packet-b"));
    assert.ok(verA && verB);

    const claims = await sql<{
      body: string;
      version_id: number | null;
      capture_event_id: number | null;
      provenance_status: string | null;
      source_url: string | null;
    }>`
      select body, version_id, capture_event_id, provenance_status, source_url
      from claims where investigation_id = ${id} and user_id = ${user} order by id
    `;
    const fromA = claims.find((c) => /sidewalk/i.test(c.body));
    const fromB = claims.find((c) => /registered agent/i.test(c.body));
    const unresolved = claims.find((c) => /no supporting document/i.test(c.body));
    const invented = claims.find((c) => /invented/i.test(c.body));
    const noQuote = claims.find((c) => /no quote/i.test(c.body));
    assert.ok(fromA && fromB && unresolved && invented && noQuote);
    assert.equal(fromA.version_id, verA.id);
    assert.equal(fromB.version_id, verB.id);
    assert.notEqual(fromA.version_id, fromB.version_id);
    assert.ok(fromA.capture_event_id != null && fromB.capture_event_id != null);
    assert.notEqual(fromA.capture_event_id, fromB.capture_event_id);
    assert.equal(fromA.provenance_status, "resolved");
    assert.equal(fromB.provenance_status, "resolved");
    assert.equal(unresolved.provenance_status, "unresolved");
    assert.equal(unresolved.version_id, null);
    assert.equal(unresolved.capture_event_id, null);
    assert.equal(invented.provenance_status, "unresolved");
    assert.equal(invented.version_id, verA.id);
    assert.equal(noQuote.provenance_status, "unresolved");
    assert.equal(noQuote.version_id, verA.id);

    const rels = await sql<{ from_name: string; version_id: number | null; provenance_status: string | null }>`
      select from_name, version_id, provenance_status from relationships
      where investigation_id = ${id} and user_id = ${user} order by id
    `;
    const relA = rels.find((r) => r.from_name === "City of Longmont");
    const relB = rels.find((r) => r.from_name === "Civic Paving LLC");
    assert.equal(relA?.version_id, verA.id);
    assert.equal(relB?.version_id, verB.id);
    assert.equal(relA?.provenance_status, "resolved");
    assert.equal(relB?.provenance_status, "resolved");
  });
});

describe("investigation-scoped entities", { timeout: 120000 }, () => {
  it("does not leak unrelated entities and labels historical matches", async () => {
    const user = `forensic-ent-${Date.now()}`;
    const { sql, id: a } = await bootInv(user, "Inv A");
    const bRows = await sql<{ id: number }>`
      insert into investigations (user_id, title) values (${user}, ${"Inv B"}) returning id
    `;
    const b = bRows[0]!.id;

    const runEntities = async (inv: number, entities: HopPlan["entities"]) => {
      await researchLoop({
        userId: user,
        investigationId: inv,
        hops: 1,
        search: async () => [],
        fetch: async () => ({ ok: false, status: 404, text: "", title: "n", extras: [] }),
        planner: async () => {
          const p = emptyPlan();
          p.entities = entities;
          p.summary = "entities only";
          return p;
        },
        archives: async () => [],
      });
    };

    await runEntities(a, [
      { name: "Peak Range Holdings LLC", kind: "company", why: "Named in investigation A packet" },
      { name: "Jane Smith", kind: "person", why: "Registered agent in investigation A only" },
    ]);
    await runEntities(b, [
      { name: "Peak Range Holdings Inc", kind: "company", why: "Similar name in investigation B — do not merge" },
    ]);

    const packA = await retrievePack(user, a, ["Peak", "Jane"]);
    const packB = await retrievePack(user, b, ["Peak"]);
    assert.match(packA, /Jane Smith/);
    assert.match(packA, /Peak Range Holdings LLC/);
    assert.equal(/Jane Smith/.test(packB.split("HISTORICAL MATCHES")[0] ?? packB), false);
    assert.match(packB, /Peak Range Holdings Inc/);
    assert.match(packB, /HISTORICAL MATCHES/);
    assert.match(packB, /Peak Range Holdings LLC/);

    const entsA = await sql<{ name: string }>`
      select e.name from investigation_entities ie
      join entities e on e.id = ie.entity_id
      where ie.investigation_id = ${a} and ie.user_id = ${user}
    `;
    const entsB = await sql<{ name: string }>`
      select e.name from investigation_entities ie
      join entities e on e.id = ie.entity_id
      where ie.investigation_id = ${b} and ie.user_id = ${user}
    `;
    assert.ok(entsA.some((e) => e.name === "Jane Smith"));
    assert.equal(entsB.some((e) => e.name === "Jane Smith"), false);
    assert.ok(entsB.some((e) => /Peak Range Holdings Inc/i.test(e.name)));
    const matches = await sql<{ verdict: string }>`
      select verdict from entity_matches where user_id = ${user}
    `;
    assert.ok(matches.length >= 1);
    assert.equal(matches.some((m) => m.verdict === "same" || m.verdict === "confirmed-same"), false);
  });
});

describe("search exhaustion", { timeout: 120000 }, () => {
  it("does not exhaust a company after one zero-result query and later finds an address hit", async () => {
    const user = `forensic-zero-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Zero then address");
    await seedInvestigation(user, id, "Staff report awards work to Acme Holdings LLC.", []);
    const ADDRESS_HIT = "https://sos.state.co.us/biz/acme-holdings";
    let zeros = 0;
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 3,
      searchAttempt: async (q) => {
        if (/address|street|coffman|registered office/i.test(q)) {
          return {
            state: "SEARCH_SUCCESS_RESULTS",
            hits: [{ title: "Acme office", url: ADDRESS_HIT, snippet: "400 Coffman Street" }],
            provider: "injected",
          };
        }
        zeros += 1;
        return { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "injected" };
      },
      fetch: async (url) => {
        if (url.includes("acme-holdings")) {
          return fetchOk(
            "Acme Holdings LLC registered office 400 Coffman Street, Longmont. Registered agent Pat Lee.",
            "Acme filing",
          );
        }
        return { ok: false, status: 404, text: "", title: "n", extras: [] };
      },
      planner: async () => {
        const p = emptyPlan();
        p.searches = ['"Acme Holdings LLC" Longmont'];
        p.summary = "search acme";
        return p;
      },
      archives: async () => [],
    });

    const item = await sql<{ status: string; search_zero_count: number | null; strategies_tried: string | null }>`
      select status, search_zero_count, strategies_tried from frontier_items
      where investigation_id = ${id} and user_id = ${user} and label = ${"Acme Holdings LLC"}
      limit 1
    `;
    assert.ok(item[0], "Acme Holdings LLC must stay on the frontier");
    assert.notEqual(item[0]!.status, "exhausted");
    assert.ok(zeros >= 1, "at least one zero-result query must have run");
    const logs = await sql<{ state: string | null; query: string }>`
      select state, query from search_log where investigation_id = ${id} and user_id = ${user} order by id
    `;
    assert.ok(logs.some((l) => l.state === "SEARCH_SUCCESS_ZERO_RESULTS"));
    assert.ok(
      logs.some((l) => l.state === "SEARCH_SUCCESS_RESULTS"),
      `later strategy should hit: ${logs.map((l) => l.query).join(" | ")}`,
    );
    const arts = await sql<{ url: string }>`
      select url from artifacts where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(arts.some((a) => a.url.includes("acme-holdings")));
  });
});

describe("autonomous monitoring", { timeout: 120000 }, () => {
  it("detects a 404 and a soft-404 on a monitored report without a human reopen", async () => {
    const user = `forensic-mon-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Monitor");
    const url = "https://longmontcolorado.gov/water/water-report.pdf";
    const body = "City of Longmont Water Quality Report. Nitrate at the treatment plant was 0.4 mg/L. ".repeat(5);
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async () => [],
      fetch: async () => fetchOk(body, "Water Quality Report"),
      planner: async () => {
        const p = emptyPlan();
        p.fetch_urls = [url];
        p.summary = "capture report";
        return p;
      },
      archives: async () => [],
    });
    await watchSource({
      userId: user,
      url,
      title: "Water Quality Report",
      investigationId: id,
      nextCheckAt: new Date("2020-01-01T00:00:00Z"),
    });

    const gone = await runDueMonitors({
      userId: user,
      now: new Date("2026-08-25T00:00:00Z"),
      fetch: async () => ({ ok: false, status: 404, text: "", title: "Not Found", extras: [] }),
      archives: async () => [
        "https://web.archive.org/web/20200101000000/https://longmontcolorado.gov/water/water-report.pdf",
      ],
    });
    assert.ok(gone.checked >= 1);
    assert.ok(gone.anomalies >= 1);
    const anoms = await sql<{ kind: string; summary: string }>`
      select kind, summary from anomalies where user_id = ${user} and url = ${canonicalPublicUrl(url)}
    `;
    assert.ok(anoms.some((a) => a.kind === "disappeared"));
    const archiveFrontier = await sql<{ label: string }>`
      select label from frontier_items
      where investigation_id = ${id} and user_id = ${user} and label like ${"%web.archive.org%"}
    `;
    assert.ok(archiveFrontier.length >= 1, "disappearance should queue a Wayback copy");

    const url2 = "https://longmontcolorado.gov/water/monthly.html";
    await rememberCapture({
      userId: user,
      investigationId: id,
      url: url2,
      title: "Monthly water quality",
      text: "City of Longmont monthly drinking water quality summary. Chlorine residual 1.1 mg/L. ".repeat(3),
      hash: await sha256("monthly-ok"),
      status: 200,
      outcome: "fetched",
    });
    await watchSource({
      userId: user,
      url: url2,
      title: "Monthly water quality",
      investigationId: id,
      nextCheckAt: new Date("2020-01-01T00:00:00Z"),
    });
    const soft = await runDueMonitors({
      userId: user,
      now: new Date("2026-08-26T00:00:00Z"),
      archives: async () => [],
      fetch: async (u) => {
        if (u.includes("monthly")) {
          return {
            ok: true,
            status: 200,
            title: "404 Not Found",
            text: "The page you requested cannot be found.",
            extras: [],
          };
        }
        return { ok: false, status: 404, text: "", title: "Not Found", extras: [] };
      },
    });
    assert.ok(soft.anomalies >= 1);
    const softAnoms = await sql<{ kind: string }>`
      select kind from anomalies where user_id = ${user} and url = ${canonicalPublicUrl(url2)}
    `;
    assert.ok(softAnoms.some((a) => a.kind === "disappeared"));

    await sql`
      update source_monitors
      set next_check_at = ${"2020-01-01T00:00:00Z"}::timestamptz
      where user_id = ${user} and url = ${canonicalPublicUrl(url)}
    `;
    const restored = await runDueMonitors({
      userId: user,
      now: new Date("2026-08-27T00:00:00Z"),
      fetch: async () => fetchOk(body, "Water Quality Report"),
      archives: async () => [
        "https://web.archive.org/web/20200101000000/https://longmontcolorado.gov/water/water-report.pdf",
      ],
    });
    assert.ok(restored.checked >= 1);
    const restAnoms = await sql<{ kind: string }>`
      select kind from anomalies where user_id = ${user} and url = ${canonicalPublicUrl(url)}
    `;
    assert.ok(restAnoms.some((a) => a.kind === "restored"));
  });
});

describe("long document evidence", { timeout: 120000 }, () => {
  it("stores a 300-page packet past the old 14K/40K cutoff and retrieves the late section", async () => {
    const user = `forensic-long-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Long packet");
    const needle = "KEYFACT_PAGE247 Peak Range Holdings secretly listed in Appendix C";
    const body = `${"Council packet header and routine consent calendar. ".repeat(2500)}\n\n${needle}\n`;
    assert.ok(body.length > 40000, `packet must exceed old PDF cap, got ${body.length}`);
    const url = "https://longmontcolorado.gov/agendas/giant-packet.html";
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async () => [],
      fetch: async () => fetchOk(body, "Giant council packet"),
      planner: async () => {
        const p = emptyPlan();
        p.fetch_urls = [url];
        p.claims.push({
          text: "Appendix C names Peak Range Holdings",
          kind: "FACT",
          evidence: needle,
          source_url: url,
          locator: "page:247",
        });
        p.summary = "fetch giant packet";
        return p;
      },
      archives: async () => [],
    });
    const canon = canonicalPublicUrl(url);
    const stored = await sql<{ full_text: string; content_hash: string }>`
      select full_text, content_hash from artifact_versions
      where user_id = ${user} and url = ${canon} limit 1
    `;
    assert.ok(stored[0]);
    assert.match(stored[0]!.full_text, /KEYFACT_PAGE247/);
    assert.ok(stored[0]!.full_text.length > 40000);
    const chunks = await findEvidenceChunks(user, id, "KEYFACT_PAGE247");
    assert.ok(chunks.length >= 1, "retrieval must locate the late section");
    const pack = await retrievePack(user, id, ["KEYFACT_PAGE247"]);
    assert.ok(pack.length < body.length, "planner context stays bounded");
    assert.match(pack, /KEYFACT_PAGE247/);
    const claim = await sql<{ locator: string | null; version_id: number | null; provenance_status: string | null }>`
      select locator, version_id, provenance_status from claims
      where investigation_id = ${id} and user_id = ${user} limit 1
    `;
    assert.equal(claim[0]?.locator, "page:247");
    assert.equal(claim[0]?.provenance_status, "resolved");
    assert.ok(claim[0]?.version_id != null);
  });
});

describe("scanned PDF OCR", { timeout: 120000 }, () => {
  it("runs OCR when native extraction fails and stores page provenance", async () => {
    const ocrText = "SCANNED Longmont water quality nitrate 0.4 mg/L page one";
    const imageOnly = new Uint8Array([
        ...new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n"),
        0,
        1,
        2,
        3,
        4,
        5,
      ]);
      const pdf = await extractPdfBetter(imageOnly, async () => ({
        text: ocrText,
        pages: [{ page: 1, text: ocrText, confidence: 0.91 }],
      }));
      assert.equal(pdf.method, "ocr");
      assert.equal(pdf.needsOcr, false);
      assert.match(pdf.text, /nitrate/);
      assert.equal(pdf.pages[0]?.page, 1);

    const user = `forensic-ocr-${Date.now()}`;
    const { sql, id } = await bootInv(user, "OCR packet");
    const url = "https://longmontcolorado.gov/water/scanned-report.pdf";
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async () => [],
      fetch: async () => ({
        ok: true,
        status: 200,
        text: ocrText,
        title: "scanned-report.pdf",
        extras: [],
        extractionMethod: "ocr",
        pages: [{ page: 1, text: ocrText, confidence: 0.91 }],
      }),
      planner: async () => {
        const p = emptyPlan();
        p.fetch_urls = [url];
        p.summary = "ocr pdf";
        return p;
      },
      archives: async () => [],
    });
    const stored = await sql<{ full_text: string; extraction_method: string | null }>`
      select full_text, extraction_method from artifact_versions
      where user_id = ${user} and url = ${canonicalPublicUrl(url)}
    `;
    assert.match(stored[0]!.full_text, /nitrate/);
    assert.equal(stored[0]!.extraction_method, "ocr");
    const chunks = await sql<{ page_number: number | null; locator: string; excerpt: string }>`
      select page_number, locator, excerpt from artifact_chunks c
      join artifact_versions av on av.id = c.version_id
      where av.user_id = ${user} and av.url = ${canonicalPublicUrl(url)}
    `;
    assert.ok(chunks.some((c) => c.page_number === 1));
    assert.ok(chunks.some((c) => /nitrate/i.test(c.excerpt)));
  });
});

describe("dead-end resurfacing", { timeout: 120000 }, () => {
  it("reopens a parked company when a later capture names it", async () => {
    const user = `forensic-dead-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Dead then live");
    await seedInvestigation(user, id, "Staff report awards work to Acme Holdings LLC.", []);
    const LATER = "https://longmontcolorado.gov/agendas/new-packet.html";
    let hop = 0;
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 2,
      search: async () => [],
      fetch: async (u) => {
        if (u.includes("new-packet")) {
          return fetchOk(
            "City Council packet names Acme Holdings LLC as the sidewalk contractor. Registered agent Pat Lee.",
            "New packet",
          );
        }
        return { ok: false, status: 404, text: "", title: "n", extras: [] };
      },
      planner: async () => {
        hop += 1;
        const p = emptyPlan();
        if (hop === 1) {
          p.dead_ends.push({
            hypothesis: "Acme Holdings LLC",
            reason: "No filings found under this spelling",
          });
          p.summary = "park the company";
        } else {
          p.fetch_urls = [LATER];
          p.summary = "new packet";
        }
        return p;
      },
      archives: async () => [],
    });
    const item = await sql<{
      status: string;
      closed_reason: string | null;
      prior_status: string | null;
    }>`
      select status, closed_reason, prior_status from frontier_items
      where investigation_id = ${id} and user_id = ${user} and label = ${"Acme Holdings LLC"}
      limit 1
    `;
    assert.ok(item[0], "Acme Holdings LLC must remain on the frontier");
    assert.equal(item[0]!.status, "reopened");
    assert.match(item[0]!.closed_reason ?? "", /revived|reopened from|materially new evidence/i);
    assert.equal(item[0]!.prior_status, "dead-end");
  });
});
