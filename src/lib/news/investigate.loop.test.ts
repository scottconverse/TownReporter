import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { heuristicPlan } from "./extract.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import {
  checkBaselines,
  emptyPlan,
  ensureInvestigateSchema,
  observeBaseline,
  persistDiscovery,
  researchLoop,
  retrievePack,
  seedInvestigation,
  type FetchFn,
  type HopPlan,
  type SearchAttemptFn,
} from "./investigate.ts";
import type { SearchAttempt } from "./search-web.ts";

const PAGE_A = "https://longmontcolorado.gov/agenda/packet.html";
const PAGE_C = "https://sos.state.co.us/biz/frms";
const PAGE_D = "https://sos.state.co.us/biz/jane-smith";
const PAGE_E = "https://peakrangeholdings.example/about";
const PDF_F = "https://records.bouldercolorado.gov/contracts/holdings.pdf";
const PAGE_H = "https://tracer.sos.colorado.gov/peak-range";
const WATER = "https://longmontcolorado.gov/water/water-report.pdf";
const WATER_ARCHIVE =
  "https://web.archive.org/web/20260115000000/https://longmontcolorado.gov/water/water-report.pdf";
const MEETING = "https://longmontcolorado.gov/government/agendas/minutes.html";
const CANCEL = "https://longmontcolorado.gov/government/agendas/cancellation.html";

const DOCS: Record<string, { text: string; title: string; extras?: string[] }> = {
  [PAGE_A]: {
    title: "Council packet",
    text: "City Council packet awards a contract to Front Range Municipal Solutions LLC for staff support.",
  },
  [PAGE_C]: {
    title: "FRMS filing",
    text: "Front Range Municipal Solutions LLC. Principal and registered agent: Jane Smith, 400 Coffman Street, Longmont.",
  },
  [PAGE_D]: {
    title: "Jane Smith agent record",
    text: "Jane Smith is registered agent for Peak Range Holdings LLC.",
  },
  [PAGE_E]: {
    title: "Peak Range Holdings",
    text: "Peak Range Holdings LLC owns parcel 1313200001 at 500 Main Street, Longmont. See attached contract packet.",
    extras: [PDF_F],
  },
  [PDF_F]: {
    title: "holdings.pdf",
    text: "PDF contract file. Contract 2024-17 awarded to Peak Range Holdings LLC following RFP 2024-09.",
  },
  [PAGE_H]: {
    title: "Contract 2024-17",
    text: "Contract 2024-17 references property parcel 1313200001 at 500 Main Street, Longmont.",
  },
  [WATER_ARCHIVE]: {
    title: "Archived water report",
    text: "Archived City of Longmont Water Quality Report. Nitrate at the treatment plant was 0.4 mg/L.",
  },
  [CANCEL]: {
    title: "Council meeting cancelled",
    text: "The regularly scheduled City Council meeting is cancelled. Next session to be noticed.",
  },
  [MEETING]: {
    title: "City Council minutes",
    text: "City Council minutes. Regular meeting of the Longmont City Council.",
  },
};

function searchHits(query: string): { title: string; url: string; snippet: string }[] {
  const q = query.toLowerCase();
  const hit = (title: string, url: string, snippet: string) => [{ title, url, snippet }];
  if (q.includes("front range municipal")) return hit("FRMS filing", PAGE_C, "Jane Smith registered agent");
  if (q.includes("jane smith")) return hit("Agent record", PAGE_D, "Peak Range Holdings LLC");
  if (q.includes("peak range holdings")) return hit("Company page", PAGE_E, "parcel 1313200001");
  if (q.includes("2024-17")) return hit("Contract record", PAGE_H, "parcel 1313200001");
  if (q.includes("cancellation") || q.includes("rescheduled") || q.includes("postponed")) {
    return hit("Cancelled", CANCEL, "meeting cancelled");
  }
  return [];
}

const fetchDoc: FetchFn = async (url) => {
  let key = url;
  try {
    key = canonicalPublicUrl(url);
  } catch {
    key = url;
  }
  const doc = DOCS[key] ?? DOCS[url];
  if (!doc) return { ok: false, status: 404, text: "", title: "Not Found", extras: [] };
  return { ok: true, status: 200, text: doc.text, title: doc.title, extras: doc.extras ?? [] };
};

async function planner(pack: string): Promise<HopPlan> {
  const tried = new Set<string>();
  for (const line of pack.split("\n")) {
    if (line.startsWith("SEARCH_")) {
      const q = line.replace(/^SEARCH_\S+\s+/, "").trim();
      if (q) tried.add(q);
    }
  }
  const h = heuristicPlan(pack, tried);
  const plan = emptyPlan();
  plan.searches = h.searches;
  plan.fetch_urls = h.fetch_urls;
  plan.frontier = h.frontier;
  plan.summary = h.summary;
  if (/Contract 2024-17/i.test(pack)) {
    plan.claims.push({
      text: "Peak Range Holdings is tied to Contract 2024-17",
      kind: "FACT",
      evidence: "PDF F references Contract 2024-17",
      source_url: PDF_F,
    });
    plan.entities.push({
      name: "Peak Range Holdings LLC",
      kind: "company",
      why: "Named on Contract 2024-17",
    });
    plan.entities.push({
      name: "Peak Range Holdings Inc",
      kind: "company",
      why: "Possible alias, do not auto-merge",
    });
  }
  return plan;
}

async function bootInv(user: string, title: string) {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title) values (${user}, ${title}) returning id
  `;
  return { sql, id: rows[0]!.id };
}

describe("researchLoop integration", { timeout: 120000 }, () => {
  it("keeps the title, unread result, and relevant capture inside the real planner boundary", async () => {
    const user = `loop-planner-budget-${Date.now()}`;
    const title = "Transit award investigation subject";
    const { id, sql } = await bootInv(user, title);
    const captureUrl = "https://records.example/award-packet";
    const target = "https://records.example/third-selected-award";
    await seedInvestigation(user, id, "", [
      { title: "Award packet", url: captureUrl, excerpt: "RELEVANT_CAPTURE_MARKER Transit award contract." },
    ]);
    for (let n = 0; n < 12; n++) {
      await sql`insert into hypotheses (user_id, newsroom_id, investigation_id, body, supporting, contradicting, status)
        values (${user}, 1, ${id}, ${`STORED_HISTORY_${n} ${"x".repeat(5000)}`}, '', '', 'open')`;
    }
    await sql`insert into search_log (user_id, newsroom_id, investigation_id, hop, query, results_json, selected_json, state)
      values (${user}, 1, ${id}, 1, ${"transit award"}, ${JSON.stringify([{ title: "Third selected award", url: target }])}, ${JSON.stringify([target])}, 'SEARCH_SUCCESS_RESULTS')`;
    let plannerInput = "";
    await researchLoop({
      userId: user, investigationId: id, hops: 1,
      planner: async (pack) => { plannerInput = pack.slice(0, 24_000); return emptyPlan(); },
      fetch: fetchDoc, archives: async () => [],
    });
    assert.match(plannerInput, new RegExp(title));
    assert.match(plannerInput, new RegExp(target));
    assert.match(plannerInput, /RELEVANT_CAPTURE_MARKER/);
  });

  it("shows an uncaptured third selected result to the planner despite stale attachments", async () => {
    const user = `loop-unread-result-${Date.now()}`;
    const { id, sql } = await bootInv(user, "Investigate procurement record");
    for (let n = 0; n < 17; n++) {
      await persistDiscovery(user, id, {
        kind: "url",
        label: `https://city.example/attachment-${n}.pdf`,
        why: "Attachment/document link on an earlier page",
        priority: 11,
      });
    }
    const captured = "https://records.example/already-read";
    const first = "https://records.example/first-result";
    const second = "https://records.example/second-result";
    const target = "https://records.example/third-result";
    await seedInvestigation(user, id, "", [
      { title: "Already read", url: captured, excerpt: "Stored record text." },
    ]);
    await sql`
      insert into search_log (user_id, newsroom_id, investigation_id, hop, query, results_json, selected_json, state)
      values
        (${user}, 1, ${id}, 1, ${"ignored failed search"}, ${"[]"}, ${JSON.stringify(["https://records.example/failed"])}, ${"SEARCH_FAILED_NETWORK"}),
        (${user}, 1, ${id}, 1, ${"ignored malformed result"}, ${"not-json"}, ${"not-json"}, ${"SEARCH_SUCCESS_RESULTS"}),
        (${user}, 1, ${id}, 1, ${"generic procurement records"},
          ${JSON.stringify([
            { title: "Already read", url: captured },
            { title: "First result", url: first },
            { title: "Second result", url: second },
            { title: "Third result", url: target },
          ])},
          ${JSON.stringify([captured, first, second, target])}, ${"SEARCH_SUCCESS_RESULTS"})
    `;

    const pack = await retrievePack(user, id, ["attachment"]);
    assert.match(pack, /UNREAD SEARCH RESULTS/);
    const unread = pack.split("UNREAD SEARCH RESULTS")[1]!.split("RELEVANT ARTIFACTS")[0]!;
    assert.match(unread, /Third result/);
    assert.ok(unread.includes(target));
    assert.match(unread, /generic procurement records/);
    assert.doesNotMatch(unread, /already-read|records\.example\/failed|malformed result/);

    const fetched: string[] = [];
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      planner: async (nextPack) => {
        assert.match(nextPack, /Third result/);
        const plan = emptyPlan();
        plan.fetch_urls = [target];
        return plan;
      },
      fetch: async (url) => {
        fetched.push(url);
        return { ok: true, status: 200, text: "Readable public record for capture.", title: "Record", extras: [] };
      },
      archives: async () => [],
    });
    assert.equal(fetched[0], target, "planner-selected result precedes stale attachment URLs");
    assert.equal(fetched.length, 4, "does not expand the existing fetch budget");
  });

  it("gives a fresh search discovery a fetch slot despite a full older attachment frontier", async () => {
    const user = `loop-search-fairness-${Date.now()}`;
    const { id } = await bootInv(user, "Investigate contract spending");
    for (let n = 0; n < 16; n++) {
      await persistDiscovery(user, id, {
        kind: "url", label: `https://longmontcolorado.gov/services/attachment-${n}.pdf`,
        why: "Attachment/document link on an earlier page", priority: 11,
      });
    }
    const found = "https://longmontcolorado.gov/contracts/actual-award.pdf";
    const requested = "https://longmontcolorado.gov/contracts/notice";
    const fetched: string[] = [];
    await researchLoop({
      userId: user, investigationId: id, hops: 1,
      planner: async () => {
        const p = emptyPlan();
        p.fetch_urls = [requested];
        p.searches = ["contract award spending"];
        return p;
      },
      search: async () => [{ title: "Contract award", url: found, snippet: "Award notice" }],
      fetch: async (url) => {
        fetched.push(url);
        return { ok: true, status: 200, text: "Public contract document with sufficient readable source text for this capture.", title: "Contract document", extras: [] };
      },
      archives: async () => [],
    });
    assert.ok(fetched.includes(found), "successful discovery must not remain unread behind old links");
    assert.ok(fetched.includes(requested), "the planner's explicit fetch must still run");
    assert.equal(fetched.length, 4, "do not solve starvation by expanding the fetch budget");
  });

  it("lets the bounded post-search selector choose a later hit before automatic discovery", async () => {
    const user = `loop-post-search-selector-${Date.now()}`;
    const { id } = await bootInv(user, "Investigate award record");
    const hits = [1, 2, 3].map((n) => ({ title: `Award result ${n}`, url: `https://records.example/result-${n}` }));
    const fetched: string[] = [];
    let selectorPack = "";
    const result = await researchLoop({
      userId: user, investigationId: id, hops: 1,
      planner: async () => { const plan = emptyPlan(); plan.searches = ["award record"]; return plan; },
      readSelector: async (pack) => {
        selectorPack = pack;
        const plan = emptyPlan(); plan.fetch_urls = [hits[2]!.url]; return plan;
      },
      searchAttempt: async () => ({ state: "SEARCH_SUCCESS_RESULTS", hits, provider: "test" }),
      fetch: async (url) => { fetched.push(url); return { ok: true, status: 200, text: "Readable award record for residents.", title: "Award", extras: [] }; },
      archives: async () => [],
    });
    assert.match(selectorPack, /POST-SEARCH RESULTS/);
    assert.match(selectorPack, /result-3/);
    assert.equal(fetched[0], hits[2]!.url);
    assert.ok(fetched.length <= 4, "selector does not expand the existing fetch budget");
    const sql = await getSql();
    const [{ generated_json: generated }] = await sql<{ generated_json: string }>`select generated_json from search_log where investigation_id=${id} and hop=1 limit 1`;
    assert.match(generated, /post_search_selected/);
    assert.match(generated, /result-3/);
    assert.equal(result.plannerFailures, 0);
  });

  it("reports selector failure while preserving the ordinary queue and search receipt", async () => {
    const user = `loop-selector-failure-${Date.now()}`;
    const { id, sql } = await bootInv(user, "Investigate award record");
    const source = "https://records.example/real-award";
    const fetched: string[] = [];
    let calls = 0;
    const result = await researchLoop({
      userId: user, investigationId: id, hops: 1,
      planner: async () => ({ ...emptyPlan(), searches: ["award record"] }),
      readSelector: async () => {
        calls++;
        return { ...emptyPlan(), planner_error: "selector unavailable", fetch_urls: ["https://records.example/heuristic-not-selected"] };
      },
      searchAttempt: async () => ({ state: "SEARCH_SUCCESS_RESULTS", hits: [{ title: "Actual award", url: source }], provider: "test" }),
      fetch: async (url) => { fetched.push(url); return { ok: true, status: 200, text: "Actual award record.", title: "Award", extras: [] }; },
      archives: async () => [],
    });
    assert.equal(calls, 1);
    assert.deepEqual(fetched, [source]);
    assert.equal(result.plannerFailures, 0);
    assert.match(result.summary, /selection fell back.*selector unavailable/);
    const [receipt] = await sql<{ generated_json: string; provider: string }>`select generated_json, provider from search_log where investigation_id=${id} and hop=1 limit 1`;
    const generated = JSON.parse(receipt!.generated_json);
    assert.equal(receipt!.provider, "test");
    assert.deepEqual(generated.post_search_selected, []);
    assert.equal(generated.post_search_failure, "selector unavailable");
  });

  it("follows company → agent → second company → PDF contract → parcel through persisted state", async () => {
    const user = `loop-chain-${Date.now()}`;
    const { sql, id } = await bootInv(user, "FRMS chain");
    await seedInvestigation(user, id, "", [
      { title: DOCS[PAGE_A]!.title, url: PAGE_A, excerpt: DOCS[PAGE_A]!.text },
    ]);

    const result = await researchLoop({
      userId: user,
      investigationId: id,
      hops: 5,
      search: async (q) => searchHits(q),
      fetch: fetchDoc,
      planner,
      archives: async () => [],
    });

    assert.ok(result.hops >= 4, `expected several hops, got ${result.hops}`);

    const arts = await sql<{ url: string }>`
      select url from artifacts where investigation_id = ${id} and user_id = ${user}
    `;
    const urls = arts.map((a) => a.url);
    assert.ok(urls.some((u) => u.includes("sos.state.co.us/biz/frms")), urls.join("\n"));
    assert.ok(urls.some((u) => u.includes("jane-smith")), urls.join("\n"));
    assert.ok(urls.some((u) => u.includes("peakrangeholdings")), urls.join("\n"));
    assert.ok(urls.some((u) => u.includes("holdings.pdf")), `PDF F must persist: ${urls.join("\n")}`);
    assert.ok(urls.some((u) => u.includes("tracer.sos.colorado.gov") || u.includes("parcel") || u.includes("2024-17") || u.includes("holdings.pdf")));

    const frontier = await sql<{ label: string }>`
      select label from frontier_items where investigation_id = ${id} and user_id = ${user}
    `;
    const labels = frontier.map((f) => f.label).join("\n");
    assert.ok(/2024-17|1313200001|Peak Range|Jane Smith/i.test(labels), labels);

    const claims = await sql<{ body: string; version_id: number | null; investigation_id: number | null }>`
      select body, version_id, investigation_id from claims
      where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(claims.length > 0, "claims should be persisted from the plan");
    assert.equal(claims[0]!.investigation_id, id);
    assert.ok(claims.some((c) => c.version_id != null), "claims must point at an artifact version");
  });

  it("a later editor on the same file sees the hops", async () => {
    const opener = `hops-opener-${Date.now()}`;
    const later = `hops-later-${Date.now()}`;
    const { sql, id } = await bootInv(opener, "Shared trail");
    await persistDiscovery(opener, id, {
      kind: "company",
      label: "Acme Holdings LLC",
      why: "Named in the packet",
      evidence: "Council packet",
      priority: 9,
      query: "Acme Holdings Longmont",
    });
    const asLater = await sql<{ label: string }>`
      select label from frontier_items where investigation_id = ${id}
    `;
    assert.equal(asLater[0]?.label, "Acme Holdings LLC");

    await researchLoop({
      userId: opener,
      investigationId: id,
      hops: 1,
      search: async () => [{ title: "Acme", url: PAGE_C, snippet: "Acme Holdings LLC" }],
      fetch: fetchDoc,
      planner: async () => {
        const p = emptyPlan();
        p.searches = ["Acme Holdings Longmont"];
        p.fetch_urls = [PAGE_C];
        p.summary = "Opener follows Acme";
        return p;
      },
      archives: async () => [],
    });

    await researchLoop({
      userId: later,
      investigationId: id,
      hops: 1,
      search: async () => [{ title: "Acme", url: PAGE_C, snippet: "Acme Holdings LLC" }],
      fetch: fetchDoc,
      planner: async () => {
        const p = emptyPlan();
        p.searches = ["Acme Holdings Longmont"];
        p.fetch_urls = [PAGE_C];
        p.summary = "Follow Acme";
        return p;
      },
      archives: async () => [],
    });
    const log = await sql<{ query: string }>`
      select query from search_log where investigation_id = ${id}
    `;
    assert.ok(log.length > 0, "later editor should write hops onto the same file");
    const arts = await sql<{ url: string }>`
      select url from artifacts where investigation_id = ${id}
    `;
    assert.ok(arts.some((a) => a.url.includes("sos.state.co.us")), arts.map((a) => a.url).join("\n"));
    const versions = await sql<{ c: number }>`
      select count(*)::int as c from artifact_versions where url = ${PAGE_C}
    `;
    assert.equal(versions[0]?.c, 1, "later editor reuses the newsroom URL history, not a second row");
    const watches = await sql<{ c: number }>`
      select count(*)::int as c from source_monitors where url = ${PAGE_C}
    `;
    assert.equal(watches[0]?.c, 1, "later editor reuses the newsroom watch, not a second row");
  });

  it("keeps the original water report when the live URL later 404s, and records disappearance", async () => {
    const user = `loop-water-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Water report");
    const live: Record<string, { ok: boolean; status: number; text: string; title: string; extras: string[] }> = {
      [WATER]: {
        ok: true,
        status: 200,
        title: "Water Quality Report",
        text: "City of Longmont Water Quality Report. Nitrate at the treatment plant was 0.4 mg/L. ".repeat(4),
        extras: [],
      },
    };

    await seedInvestigation(user, id, "", [
      { title: "Water desk", url: "https://www.longmontcolorado.gov/water", excerpt: `Monthly report at ${WATER}` },
    ]);

    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 2,
      search: async () => [{ title: "Water report", url: WATER, snippet: "nitrate" }],
      fetch: async (url) => live[url] ?? { ok: false, status: 404, text: "", title: "Not Found", extras: [] },
      planner: async () => {
        const p = emptyPlan();
        p.fetch_urls = [WATER];
        p.summary = "Fetch the water report";
        return p;
      },
      archives: async () => [],
    });

    const day1 = await sql<{ id: number; content_hash: string; fetch_status: number | null; fetch_outcome: string }>`
      select id, content_hash, fetch_status, fetch_outcome from artifact_versions
      where user_id = ${user} and url = ${WATER} order by id asc
    `;
    assert.ok(day1.length >= 1);
    assert.equal(day1[0]!.fetch_status, 200);
    const originalHash = day1[0]!.content_hash;
    assert.notEqual(originalHash, "missing");

    live[WATER] = { ok: false, status: 404, text: "", title: "Not Found", extras: [] };

    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 2,
      search: async () => [],
      fetch: async (url) => live[url] ?? { ok: false, status: 404, text: "", title: "Not Found", extras: [] },
      planner: async () => {
        const p = emptyPlan();
        p.fetch_urls = [WATER];
        p.summary = "Recheck the water report";
        return p;
      },
      archives: async (url) => (url.includes("water-report") ? [WATER_ARCHIVE] : []),
    });

    const versions = await sql<{ content_hash: string; fetch_status: number | null; fetch_outcome: string }>`
      select content_hash, fetch_status, fetch_outcome from artifact_versions
      where user_id = ${user} and url = ${WATER} order by id asc
    `;
    assert.ok(
      versions.some((v) => v.content_hash === originalHash && v.fetch_status === 200),
      "original capture must remain",
    );
    assert.ok(
      versions.some((v) => v.fetch_outcome === "removed" || v.fetch_status === 404 || v.content_hash === "missing"),
      JSON.stringify(versions),
    );

    const anoms = await sql<{ kind: string; summary: string }>`
      select kind, summary from anomalies where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(
      anoms.some((a) => a.kind === "disappeared"),
      `expected disappeared anomaly, got ${anoms.map((a) => a.kind).join(",")}`,
    );

    const found = await sql<{ label: string }>`
      select label from frontier_items where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(
      found.some((f) => f.label.includes("web.archive.org") || f.label.includes("wayback") || f.label.includes("relocated")),
      found.map((f) => f.label).join("\n"),
    );
  });

  it("treats a soft-404 after a real capture as removed, not a routine change", async () => {
    const user = `loop-soft-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Soft 404");
    const url = "https://longmontcolorado.gov/water/monthly.html";
    const live = {
      body: {
        ok: true,
        status: 200,
        title: "Monthly water quality",
        text: "City of Longmont monthly drinking water quality summary. Chlorine residual 1.1 mg/L. ".repeat(3),
        extras: [] as string[],
      },
    };
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async () => [],
      fetch: async () => live.body,
      planner: async () => {
        const p = emptyPlan();
        p.fetch_urls = [url];
        p.summary = "fetch";
        return p;
      },
      archives: async () => [],
    });
    live.body = {
      ok: true,
      status: 200,
      title: "404 Not Found",
      text: "The page you requested cannot be found.",
      extras: [],
    };
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async () => [],
      fetch: async () => live.body,
      planner: async () => {
        const p = emptyPlan();
        p.fetch_urls = [url];
        p.summary = "recheck";
        return p;
      },
      archives: async () => [],
    });
    const versions = await sql<{ fetch_outcome: string }>`
      select fetch_outcome from artifact_versions where user_id = ${user} and url = ${url} order by id asc
    `;
    assert.ok(versions.some((v) => v.fetch_outcome === "removed" || v.fetch_outcome === "soft-404"), JSON.stringify(versions));
    const anoms = await sql<{ kind: string }>`
      select kind from anomalies where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(anoms.some((a) => a.kind === "disappeared"));
    assert.equal(anoms.some((a) => a.kind === "changed"), false);
  });

  it("does not treat a failed search as zero results", async () => {
    const user = `loop-searchfail-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Search failure");
    const attempt: SearchAttemptFn = async (_query): Promise<SearchAttempt> => ({
      state: "SEARCH_FAILED_PROVIDER",
      hits: [],
      provider: "ddg-html",
      error: "HTTP 500",
    });
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      searchAttempt: attempt,
      fetch: fetchDoc,
      planner: async () => {
        const p = emptyPlan();
        p.searches = ["Front Range Municipal Solutions LLC Longmont"];
        p.summary = "search";
        return p;
      },
      archives: async () => [],
    });
    const logs = await sql<{ state: string | null; query: string }>`
      select state, query from search_log where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(logs.some((l) => l.state === "SEARCH_FAILED_PROVIDER"));
    assert.equal(logs.some((l) => l.state === "SEARCH_SUCCESS_ZERO_RESULTS"), false);
    const anoms = await sql<{ kind: string }>`
      select kind from anomalies where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(anoms.some((a) => a.kind === "search-failed"));
  });

  it("does not spend every hop when a failed planner has no heuristic work to run", async () => {
    const user = `loop-planner-startup-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Planner startup failure");
    let searches = 0;

    const result = await researchLoop({
      userId: user,
      investigationId: id,
      hops: 5,
      search: async () => {
        searches += 1;
        return [];
      },
      fetch: fetchDoc,
      planner: async () => ({
        ...emptyPlan(),
        summary: "Heuristic hop: 0 searches, 0 fetches, 0 frontier items.",
        planner_error: "Codex could not start because permission was denied",
      }),
      archives: async () => [],
    });

    assert.equal(result.hops, 0, "a provider failure without a source action is not a research hop");
    assert.equal(result.plannerFailures, 1, "record the one failed provider attempt without retrying it");
    assert.equal(searches, 0, "a failed planner is distinct from a completed zero-result search");
    const row = await sql<{ hops: number }>`
      select hops from investigations where id = ${id}
    `;
    assert.equal(row[0]?.hops, 0);
  });

  it("learns a meeting cadence and flags a missing meeting without dropping the anomaly", async () => {
    const user = `loop-meet-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Missing meeting");
    const t1 = new Date("2026-05-12T18:00:00Z");
    const t2 = new Date("2026-05-26T18:00:00Z");
    const t3 = new Date("2026-06-09T18:00:00Z");
    await observeBaseline(user, MEETING, "City Council minutes", t1);
    await observeBaseline(user, MEETING, "City Council minutes", t2);
    await observeBaseline(user, MEETING, "City Council minutes", t3);
    const n = await checkBaselines(user, id, new Date("2026-08-25T18:00:00Z"));
    assert.ok(n >= 1);
    const anoms = await sql<{ kind: string; details: string }>`
      select kind, details from anomalies where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(anoms.some((a) => a.kind === "missing-cadence"));
    assert.match(anoms.find((a) => a.kind === "missing-cadence")!.details, /cadence/i);

    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 2,
      search: async (q) => searchHits(q),
      fetch: fetchDoc,
      planner,
      archives: async () => [],
    });
    const still = await sql<{ kind: string }>`
      select kind from anomalies where investigation_id = ${id} and user_id = ${user} and kind = ${"missing-cadence"}
    `;
    assert.ok(still.length >= 1, "innocent cancellation must not erase the absence record");
    const fetchedCancel = await sql<{ url: string }>`
      select url from artifacts where investigation_id = ${id} and user_id = ${user} and url = ${CANCEL}
    `;
    assert.ok(fetchedCancel.length >= 1, "should fetch the cancellation notice");
  });

  it("isolates artifacts and claims per investigation while sharing global URL history", async () => {
    const user = `loop-prov-${Date.now()}`;
    const { sql, id: a } = await bootInv(user, "Inv A");
    const bRows = await sql<{ id: number }>`
      insert into investigations (user_id, title) values (${user}, ${"Inv B"}) returning id
    `;
    const b = bRows[0]!.id;
    const page = "https://longmontcolorado.gov/shared/report.html";
    const body = "Shared water quality report body with enough text to count as a real capture for hashing.";

    for (const inv of [a, b]) {
      await researchLoop({
        userId: user,
        investigationId: inv,
        hops: 1,
        search: async () => [],
        fetch: async () => ({ ok: true, status: 200, text: body, title: "Shared report", extras: [] }),
        planner: async () => {
          const p = emptyPlan();
          p.fetch_urls = [page];
          p.claims.push({
            text: `Seen in investigation ${inv}`,
            kind: "FACT",
            evidence: body.slice(0, 120),
            source_url: page,
          });
          p.summary = "fetch shared";
          return p;
        },
        archives: async () => [],
      });
    }

    const versions = await sql<{ id: number }>`
      select id from artifact_versions where user_id = ${user} and url = ${page}
    `;
    assert.equal(versions.length, 1, "one global historical sequence for the URL");

    const artsA = await sql<{ url: string; version_id: number | null }>`
      select url, version_id from artifacts where investigation_id = ${a} and user_id = ${user}
    `;
    const artsB = await sql<{ url: string; version_id: number | null }>`
      select url, version_id from artifacts where investigation_id = ${b} and user_id = ${user}
    `;
    assert.ok(artsA.some((r) => r.url === page));
    assert.ok(artsB.some((r) => r.url === page));
    assert.equal(artsA[0]!.version_id, versions[0]!.id);
    assert.equal(artsB[0]!.version_id, versions[0]!.id);

    const claimsA = await sql<{ investigation_id: number | null; version_id: number | null }>`
      select investigation_id, version_id from claims where investigation_id = ${a} and user_id = ${user}
    `;
    const claimsB = await sql<{ investigation_id: number | null }>`
      select investigation_id from claims where investigation_id = ${b} and user_id = ${user}
    `;
    const leaked = await sql<{ id: number }>`
      select id from claims where investigation_id = ${a} and body like ${"%investigation " + b + "%"}
    `;
    assert.ok(claimsA.length >= 1);
    assert.ok(claimsB.length >= 1);
    assert.equal(claimsA[0]!.version_id, versions[0]!.id);
    assert.equal(leaked.length, 0);
  });

  it("keeps every new planner frontier query pending without marking it tried", async () => {
    const user = `loop-pending-new-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Candidate records");
    const pending = [
      '"Avery Candidate" endorsements Longmont',
      '"Avery Candidate" campaign contribution Colorado',
      '"Avery Candidate" city council votes',
    ];
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      planner: async () => ({
        ...emptyPlan(),
        frontier: [{
          kind: "unknown",
          label: "Candidate political identity and endorsements",
          why: "Candidate-specific official and campaign records remain unread.",
          priority: 9,
          queries: pending,
        }],
      }),
      search: async () => [],
      fetch: fetchDoc,
      archives: async () => [],
    });
    const [row] = await sql<{ next_steps: string; queries_tried: string }>`
      select next_steps, queries_tried from frontier_items
      where investigation_id = ${id} and label = ${"Candidate political identity and endorsements"}
    `;
    assert.ok(row, "planner frontier should be retained");
    for (const query of pending) assert.match(row.next_steps, new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(JSON.parse(row.queries_tried), [], "pending planner actions are not searches already tried");
  });

  it("merges later planner frontier queries into an existing row without falsely trying them", async () => {
    const user = `loop-pending-existing-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Candidate records");
    const label = "Candidate political identity and endorsements";
    await sql`
      insert into frontier_items (user_id, newsroom_id, investigation_id, kind, label, label_norm, why, priority, next_steps, queries_tried)
      values (${user}, 1, ${id}, ${"unknown"}, ${label}, ${label.toLowerCase()}, ${"Older broad question"}, 9, ${`"${label}" Longmont`}, ${"[]"})
    `;
    const pending = [
      '"Avery Candidate" endorsements Longmont',
      '"Avery Candidate" campaign contribution Colorado',
    ];
    const oldQuery = `"${label}" Longmont`;
    const searched: string[] = [];
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      planner: async () => ({
        ...emptyPlan(),
        frontier: [{ kind: "unknown", label, why: "Specific candidate records remain unread.", priority: 9, queries: pending }],
      }),
      search: async (query) => {
        searched.push(query);
        return [];
      },
      fetch: fetchDoc,
      archives: async () => [],
    });
    const [row] = await sql<{ next_steps: string; queries_tried: string }>`
      select next_steps, queries_tried from frontier_items where investigation_id = ${id} and label = ${label}
    `;
    assert.ok(row);
    for (const query of pending) assert.match(row.next_steps, new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(searched.includes(oldQuery), "the pre-existing pending action actually ran");
    const tried = JSON.parse(row.queries_tried) as string[];
    assert.ok(tried.includes(oldQuery), "preserve actual searched-query history");
    for (const query of pending) assert.ok(!tried.includes(query), "a queued planner action is not a completed search");
  });
});
