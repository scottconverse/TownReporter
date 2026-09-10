import assert from "node:assert/strict";
import test from "node:test";
import { getSql } from "../db.ts";
import {
  emptyPlan,
  ensureInvestigateSchema,
  persistDiscovery,
  researchLoop,
  retrievePack,
} from "./investigate.ts";
import { searchWithFallback } from "./search-web.ts";

test("research loop retains search-quality provenance and captures the ranked result", async () => {
  const previousGateway = process.env.TOWNREPORTER_GATEWAY_MCP_URL;
  delete process.env.TOWNREPORTER_GATEWAY_MCP_URL;
  try {
    await ensureInvestigateSchema();
    const sql = await getSql();
    const user = "isolated-search-quality";
    const [{ id }] = await sql<{ id: number }>`insert into investigations (user_id, title)
      values (${user}, 'Election candidate records') returning id`;
    const target = "https://records.example/election-candidates";
    const fetched: string[] = [];
    await researchLoop({
      userId: user, investigationId: id, hops: 1,
      place: { city: "Exampleton", state: "Colorado" },
      officialDomains: ["records.example"],
      planner: async () => {
        const plan = emptyPlan();
        plan.searches = ["election candidate affiliations"];
        return plan;
      },
      searchAttempt: (query) => searchWithFallback(query, [
        async () => ({ state: "SEARCH_SUCCESS_RESULTS", provider: "broad-fixture",
          hits: [{ title: "Welcome", url: "https://tourism.example/", snippet: "Hotels" }] }),
        async () => ({ state: "SEARCH_SUCCESS_RESULTS", provider: "record-fixture",
          hits: [{ title: "Election candidate records", url: target, snippet: query }] }),
      ], { officialDomains: ["records.example"], localityStopwords: ["Exampleton", "Colorado"] }),
      fetch: async (url) => {
        fetched.push(url);
        return { ok: true, status: 200, title: "Fixture record", extras: [],
          text: "Synthetic public election candidate record for testing capture persistence only." };
      },
      archives: async () => [],
    });
    assert.equal(fetched[0], target);
    const logs = await sql<{ id: number; results_json: string; selected_json: string }>`
      select id, results_json, selected_json from search_log where investigation_id = ${id}`;
    assert.ok(logs.length > 0);
    for (const log of logs) {
      assert.equal(JSON.parse(log.selected_json)[0], target);
      assert.equal(JSON.parse(log.results_json)[0].provider, "record-fixture");
      const attempts = await sql<{ provider: string; error: string | null }>`
        select provider, error from search_attempts where search_log_id = ${log.id} order by id`;
      assert.deepEqual(attempts.map((row) => row.provider), ["broad-fixture", "record-fixture"]);
      const metadata = attempts.filter((row) => row.error?.startsWith("search-metadata:"))
        .map((row) => JSON.parse(row.error!.slice("search-metadata:".length)));
      assert.ok(metadata.some((entry) => entry.relevance?.decision === "relevant"
        && entry.relevance?.selectedUrl === target), "persist assessment rather than lose it after dispatch");
    }
    const captures = await sql<{ url: string }>`select url from artifacts where investigation_id = ${id}`;
    assert.ok(captures.some((row) => row.url === target));
  } finally {
    if (previousGateway === undefined) delete process.env.TOWNREPORTER_GATEWAY_MCP_URL;
    else process.env.TOWNREPORTER_GATEWAY_MCP_URL = previousGateway;
  }
});

test("research loop defers degraded hits and follows only relevant document extras", async () => {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const user = "isolated-inv9-shaped-admission";
  const [{ id }] = await sql<{ id: number }>`insert into investigations (user_id, title)
    values (${user}, 'Did another candidate in North Valley, Dakota split the vote against Shakeel Dalal?') returning id`;
  const official = "https://records.example/2025-mayor-results.pdf";
  const disclosure = "https://records.example/candidate-campaign-disclosure.pdf";
  const probation = "https://records.example/municipal-probation";
  const locationHostNoise = "https://north.valley.dakota.gov/municipal-probation";
  const wikiAdmin = "https://en.wikipedia.org/wiki/Wikipedia:Contact_us";
  const imdb = "https://imdb.example/title/tt0096328";
  const genericName = "https://en.wikipedia.org/wiki/Sarah";
  const trackedNoise = "https://www.noise.example/candidate/?utm_source=test#page=2";
  const viewerNoise = "https://noise.example/candidate?nodeId=123";
  const fetched: string[] = [];
  let plannerHop = 0;
  await researchLoop({
    userId: user, investigationId: id, hops: 3,
    place: { city: "Exampleton", state: "Colorado" },
    officialDomains: ["records.example"],
    planner: async () => {
      plannerHop += 1;
      const plan = emptyPlan();
      plan.searches = [`admission-hop-${plannerHop} ${plannerHop === 1 ? "2025 mayor results Shakeel Dalal" : "Sarah candidate affiliation"}`];
      plan.questions = ["Find candidate campaign disclosure records for Shakeel Dalal"];
      return plan;
    },
    searchAttempt: async (query) => {
      if (query.includes("admission-hop-1")) return {
        state: "SEARCH_SUCCESS_RESULTS", provider: "record-fixture",
        hits: [{ title: "Certified mayor results", url: official, snippet: "Shakeel Dalal mayor results" }],
        relevance: { decision: "relevant", reason: "fixture", meaningfulQueryTokens: ["shakeel", "dalal"], selectedUrl: official },
      };
      if (!query.includes("admission-hop-2")) return {
        state: "SEARCH_SUCCESS_ZERO_RESULTS", provider: "zero-fixture", hits: [],
      };
      return {
        state: "SEARCH_SUCCESS_RESULTS", provider: "degraded-fixture",
        hits: [
          { title: "Unrelated film", url: imdb, snippet: "film" },
          { title: "Sarah", url: genericName, snippet: "given name" },
          { title: "Tracked noise", url: trackedNoise, snippet: "unrelated" },
          { title: "Viewer noise", url: viewerNoise, snippet: "unrelated" },
        ],
        warnings: ["IRRELEVANT_RESULTS_RETAINED"],
        relevance: { decision: "degraded", reason: "fixture", meaningfulQueryTokens: ["sarah", "candidate"], selectedUrl: imdb },
      };
    },
    fetch: async (url) => {
      fetched.push(url);
      return {
        ok: true, status: 200, title: "Fixture record", text: "Election record fixture.",
        extras: url === official ? [probation, locationHostNoise, wikiAdmin, disclosure] : [],
      };
    },
    archives: async () => [],
  });

  assert.equal(fetched[0], official);
  assert.ok(fetched.includes(disclosure), "relevant candidate-disclosure document should remain admitted");
  assert.ok(!fetched.includes(probation), "unrelated same-host page should not be blanket-allowed");
  assert.ok(!fetched.includes(locationHostNoise), "location words in a hostname should not create relevance");
  assert.ok(!fetched.includes(wikiAdmin), "generic administration link should not be followed");
  assert.ok(!fetched.includes(imdb) && !fetched.includes(genericName), "degraded search hits should not consume fetch slots");
  const deferred = await sql<{ label: string; status: string }>`select label,status from frontier_items
    where investigation_id=${id} and label in (${imdb},${genericName}) order by label`;
  assert.deepEqual(deferred.map((row) => row.status), ["deferred", "deferred"]);
  const canonicalDeferred = await sql<{ label: string; status: string }>`select label,status from frontier_items
    where investigation_id=${id} and label_norm='https://noise.example/candidate'`;
  assert.deepEqual(canonicalDeferred, [{ label: "https://noise.example/candidate", status: "deferred" }]);
  assert.ok(!fetched.some((url) => /noise\.example\/candidate/.test(url)),
    "tracking, fragment, and viewer variants must stay deferred on the distinct third hop");
});

test("an authorized later actor can defer an existing canonical frontier row", async () => {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const creator = "frontier-creator-a";
  const actor = "authorized-actor-b";
  const [{ id }] = await sql<{ id: number }>`insert into investigations (user_id, title)
    values (${actor}, 'Candidate filing review') returning id`;
  const storedVariant = "https://www.noise.example/file/?utm_source=creator#page=2";
  const laterVariant = "https://noise.example/file?nodeId=77";
  await persistDiscovery(creator, id, {
    kind: "url", label: storedVariant, why: "earlier actor saved this", evidence: "creator evidence", priority: 9,
  });
  await sql`update frontier_items set status='resolved',closed_reason='Earlier review'
    where investigation_id=${id} and label_norm='https://noise.example/file'`;
  const fetched: string[] = [];
  let hop = 0;
  await researchLoop({
    userId: actor, investigationId: id, hops: 3,
    planner: async () => {
      hop += 1;
      const plan = emptyPlan();
      plan.searches = [`actor-hop-${hop}`];
      return plan;
    },
    searchAttempt: async (query) => query.includes("actor-hop-2")
      ? {
          state: "SEARCH_SUCCESS_RESULTS", provider: "degraded-fixture",
          hits: [{ title: "New irrelevant representation", url: laterVariant, snippet: "not candidate evidence" }],
          relevance: { decision: "degraded", reason: "fixture", meaningfulQueryTokens: ["candidate"], selectedUrl: laterVariant },
        }
      : { state: "SEARCH_SUCCESS_ZERO_RESULTS", provider: "zero-fixture", hits: [] },
    fetch: async (url) => {
      fetched.push(url);
      return { ok: true, status: 200, title: "Unexpected", text: "Unexpected fetch", extras: [] };
    },
    archives: async () => [],
  });
  const rows = await sql<{ label: string; status: string; user_id: string }>`select label,status,user_id
    from frontier_items where investigation_id=${id} and label_norm='https://noise.example/file'`;
  assert.deepEqual(rows, [{ label: "https://noise.example/file", status: "deferred", user_id: creator }]);
  assert.ok(!fetched.includes("https://noise.example/file"),
    "actor B's deferred transition must prevent actor A's canonical row from being fetched on hop 3");
});

test("research loop preserves opaque civic document attachments within the existing budget", async () => {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const user = "isolated-opaque-documents";
  const [{ id }] = await sql<{ id: number }>`insert into investigations (user_id, title)
    values (${user}, 'Review the council filing') returning id`;
  const parent = "https://civic.example/meeting";
  const opaqueViewer = "https://civic.example/DocumentCenter/View/1234/agenda";
  const numericPdf = "https://civic.example/files/8472.pdf";
  const apiDocument = "https://civic.example/api/Document/2840869";
  const navigation = "https://civic.example/parks-and-recreation";
  const fetched: string[] = [];
  await researchLoop({
    userId: user, investigationId: id, hops: 2,
    planner: async () => {
      const plan = emptyPlan();
      plan.fetch_urls = [parent];
      return plan;
    },
    fetch: async (url) => {
      fetched.push(url);
      return { ok: true, status: 200, title: "Fixture", text: "Council filing fixture.",
        extras: url === parent ? [opaqueViewer, numericPdf, apiDocument, navigation] : [] };
    },
    archives: async () => [],
  });
  assert.deepEqual(fetched.slice(0, 4), [parent, opaqueViewer, numericPdf, apiDocument]);
  assert.ok(!fetched.includes(navigation), "ordinary unrelated navigation should not be eagerly fetched");
  const [{ status }] = await sql<{ status: string }>`select status from frontier_items
    where investigation_id=${id} and label=${navigation}`;
  assert.equal(status, "deferred", "irrelevant sibling remains preserved rather than discarded");
});

test("planner pack keeps active frontier visible ahead of deferred noise", async () => {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const user = "isolated-frontier-order";
  const [{ id }] = await sql<{ id: number }>`insert into investigations (user_id, title)
    values (${user}, 'Candidate disclosure records') returning id`;
  for (let n = 0; n < 16; n += 1) {
    const label = `https://noise.example/deferred-${n}`;
    await sql`insert into frontier_items
      (user_id,investigation_id,kind,label,label_norm,why,priority,next_steps,status)
      values (${user},${id},'url',${label},${label},'saved degraded result',99,${label},'deferred')`;
  }
  await sql`insert into frontier_items
    (user_id,investigation_id,kind,label,label_norm,why,priority,next_steps,status)
    values (${user},${id},'record','Candidate campaign disclosure filing','candidate campaign disclosure filing',
      'live question still needs an answer',1,'find the filing','open')`;

  const pack = await retrievePack(user, id, []);
  assert.match(pack, /open 1 record: Candidate campaign disclosure filing/);
  const [{ count }] = await sql<{ count: number }>`select count(*)::int count from frontier_items
    where investigation_id=${id} and status='deferred'`;
  assert.equal(count, 16, "deferred evidence remains durable even when it no longer crowds out active work");
});
