import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { DARK_PLANNER, DARK_SYSTEM } from "./dark-prompt.ts";
import { isConfirmedSame } from "./entity-resolve.ts";
import {
  emptyPlan,
  ensureInvestigateSchema,
  persistDiscovery,
  researchLoop,
  type FetchFn,
  type HopPlan,
} from "./investigate.ts";
import { remainingStrategies } from "./strategies.ts";

async function bootInv(user: string, title: string) {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title) values (${user}, ${title}) returning id
  `;
  return { sql, id: rows[0]!.id };
}

const fetchOk = (
  text: string,
  title: string,
  extras: Partial<Awaited<ReturnType<FetchFn>>> = {},
): Awaited<ReturnType<FetchFn>> => ({
  ok: true,
  status: 200,
  text,
  title,
  extras: extras.extras ?? [],
  classification: extras.classification,
  outcome: extras.outcome,
  rawBytes: extras.rawBytes,
});

describe("prompt non-gating contract", () => {
  it("forbids certainty-as-permission and does not categorically suppress coordination", () => {
    assert.match(DARK_SYSTEM, /NON-GATING RULE/);
    assert.match(DARK_SYSTEM, /CONTINUE investigating/i);
    assert.match(DARK_SYSTEM, /Coordination MAY still be journalistically relevant/i);
    assert.doesNotMatch(DARK_SYSTEM, /The story is never ['']these people were organized['']/i);
    assert.match(DARK_SYSTEM, /not a shield against a documented public-interest hop/i);
    assert.match(DARK_PLANNER, /"stop": true only when the remaining frontier is empty/i);
    assert.match(DARK_PLANNER, /possible-same \/ unresolved/i);
  });
});

describe("investigative freedom", { timeout: 120000 }, () => {
  it("unknown source classification is still followed", async () => {
    const user = `nongate-unknown-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Unknown source");
    const url = "https://civic-forum.example/thread/water-bid.html";
    const body =
      "Anonymous poster says Acme Holdings LLC just won a city sidewalk contract. Named on the award sheet.";

    const result = await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async () => [],
      fetch: async () => fetchOk(body, "Forum thread", { classification: "unknown" }),
      planner: async () => {
        const p = emptyPlan();
        p.fetch_urls = [url];
        p.summary = "follow unclassified URL";
        return p;
      },
      archives: async () => [],
    });

    const arts = await sql<{ url: string; classification: string }>`
      select url, classification from artifacts
      where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(arts.some((a) => a.url.includes("civic-forum.example")));
    assert.ok(
      arts.some((a) => a.classification === "unknown" || a.classification === "discovered"),
      JSON.stringify(arts),
    );
    const frontier = await sql<{ label: string; status: string }>`
      select label, status from frontier_items
      where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(
      frontier.some((f) => /Acme Holdings LLC/i.test(f.label)),
      frontier.map((f) => f.label).join(" | "),
    );
    assert.ok(result.frontier > 0 || frontier.length > 0);
  });

  it("unresolved identity keeps both people alive and does not merge them", async () => {
    const user = `nongate-ident-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Identity");

    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async () => [],
      fetch: async () => ({ ok: false, status: 404, text: "", title: "n", extras: [] }),
      planner: async () => {
        const p = emptyPlan();
        p.entities = [
          { name: "Jane Smith", kind: "person", why: "Registered agent on the SOS filing" },
          { name: "Jane A. Smith", kind: "person", why: "Applicant on PLN-2024-18 — may or may not be the same person" },
        ];
        p.summary = "two possible identities";
        return p;
      },
      archives: async () => [],
    });

    const ents = await sql<{ name: string; canonical: string }>`
      select e.name, e.canonical from investigation_entities ie
      join entities e on e.id = ie.entity_id
      where ie.investigation_id = ${id} and ie.user_id = ${user}
    `;
    const names = ents.map((e) => e.name);
    assert.ok(names.some((n) => n === "Jane Smith"), names.join(","));
    assert.ok(names.some((n) => n === "Jane A. Smith"), names.join(","));
    assert.notEqual(
      ents.find((e) => e.name === "Jane Smith")?.canonical,
      ents.find((e) => e.name === "Jane A. Smith")?.canonical,
    );

    const matches = await sql<{ verdict: string; left_canonical: string; right_canonical: string }>`
      select verdict, left_canonical, right_canonical from entity_matches
      where user_id = ${user}
    `;
    assert.ok(matches.length >= 1, "uncertainty must be recorded");
    assert.ok(
      matches.every((m) => !isConfirmedSame(m.verdict as "same")),
      JSON.stringify(matches),
    );

    const frontier = await sql<{ label: string; status: string }>`
      select label, status from frontier_items
      where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(frontier.some((f) => /Jane Smith/i.test(f.label) && !/Jane A/i.test(f.label)));
    assert.ok(frontier.some((f) => /Jane A\. Smith/i.test(f.label)));
    assert.ok(frontier.every((f) => f.status !== "dead-end" && f.status !== "exhausted"));
  });

  it("a weak source can generate a strong lead without being promoted to fact", async () => {
    const user = `nongate-weak-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Weak source");
    const blog = "https://longmont-rumors.example/posts/sidewalk.html";
    const contract = "https://longmontcolorado.gov/contracts/2024-17.pdf";
    const blogText =
      "Someone on NextDoor claims Contract 2024-17 went to Peak Range Holdings LLC. Unverified.";
    const contractText =
      "City of Longmont Contract 2024-17 awarded to Peak Range Holdings LLC for sidewalk reconstruction. Amount $184,000.";
    let hop = 0;

    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 2,
      search: async () => [{ title: "Rumor post", url: blog, snippet: "Contract 2024-17" }],
      fetch: async (url) => {
        if (url.includes("longmont-rumors")) {
          return fetchOk(blogText, "Rumor post", { classification: "weak", extras: [contract] });
        }
        if (url.includes("2024-17")) return fetchOk(contractText, "Contract 2024-17");
        return { ok: false, status: 404, text: "", title: "n", extras: [] };
      },
      planner: async () => {
        hop += 1;
        const p = emptyPlan();
        if (hop === 1) {
          p.fetch_urls = [blog];
          p.claims.push({
            text: "A commenter said Peak Range Holdings won Contract 2024-17",
            kind: "ALLEGATION",
            evidence: blogText,
            source_url: blog,
            confidence: 0.15,
          });
          p.frontier.push({
            label: "Contract 2024-17",
            kind: "contract",
            why: "Named by a weak source — fetch the primary record",
            priority: 12,
            queries: ['"Contract 2024-17" Longmont'],
          });
          p.summary = "weak source points at a contract";
        } else {
          p.fetch_urls = [contract];
          p.claims.push({
            text: "Contract 2024-17 was awarded to Peak Range Holdings LLC",
            kind: "FACT",
            evidence: contractText,
            source_url: contract,
            confidence: 0.92,
          });
          p.summary = "primary contract record";
        }
        return p;
      },
      archives: async () => [],
    });

    const arts = await sql<{ url: string; classification: string }>`
      select url, classification from artifacts
      where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(arts.some((a) => a.url.includes("longmont-rumors")));
    assert.ok(arts.some((a) => a.url.includes("2024-17")), arts.map((a) => a.url).join("\n"));

    const claims = await sql<{ body: string; kind: string; confidence: string | number | null }>`
      select body, kind, confidence from claims
      where investigation_id = ${id} and user_id = ${user}
    `;
    const rumor = claims.find((c) => /commenter/i.test(c.body));
    const primary = claims.find((c) => /was awarded/i.test(c.body));
    assert.equal(rumor?.kind, "ALLEGATION");
    assert.equal(primary?.kind, "FACT");
    assert.ok(Number(rumor?.confidence ?? 1) < 0.5);
  });

  it("an exhausted company reopens when October evidence names it", async () => {
    const user = `nongate-reopen-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Reopen");
    await sql`
      insert into frontier_items (
        user_id, investigation_id, kind, label, why, evidence, priority, status, closed_reason,
        queries_tried, strategies_tried, strategies_budget, search_zero_count
      ) values (
        ${user}, ${id}, ${"company"}, ${"Acme Holdings LLC"},
        ${"August SOS search went nowhere"},
        ${"August: SOS business search returned nothing useful."},
        ${6}, ${"exhausted"}, ${"All research strategies attempted in August"},
        ${JSON.stringify(['"Acme Holdings LLC" Longmont'])},
        ${JSON.stringify(["exact-name", "stripped-suffix"])},
        ${JSON.stringify(["exact-name", "stripped-suffix", "contract"])},
        ${2}
      )
    `;

    await persistDiscovery(user, id, {
      kind: "company",
      label: "Acme Holdings LLC",
      why: "Newly discovered city contract names the company",
      evidence: "October: City contract 2024-19 names Acme Holdings LLC as the awardee.",
      priority: 11,
      query: '"Acme Holdings LLC" "2024-19"',
    });

    const row = await sql<{
      status: string;
      prior_status: string | null;
      reopened_from: string | null;
      reopened_at: string | null;
      evidence: string;
      queries_tried: string;
      closed_reason: string | null;
    }>`
      select status, prior_status, reopened_from, reopened_at::text as reopened_at, evidence,
             queries_tried, closed_reason
      from frontier_items
      where investigation_id = ${id} and user_id = ${user} and label = ${"Acme Holdings LLC"}
    `;
    assert.equal(row[0]?.status, "reopened");
    assert.equal(row[0]?.prior_status, "exhausted");
    assert.match(row[0]?.reopened_from ?? "", /2024-19/);
    assert.ok(row[0]?.reopened_at);
    assert.match(row[0]?.evidence ?? "", /August/);
    assert.match(row[0]?.evidence ?? "", /October/);
    assert.match(row[0]?.queries_tried ?? "", /Acme Holdings LLC/);
    assert.match(row[0]?.closed_reason ?? "", /Reopened from exhausted/);

    const searched: string[] = [];
    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async (q) => {
        searched.push(q);
        return [
          {
            title: "Contract 2024-19",
            url: "https://longmontcolorado.gov/contracts/2024-19.html",
            snippet: "Acme Holdings LLC",
          },
        ];
      },
      fetch: async () =>
        fetchOk(
          "City of Longmont Contract 2024-19 awarded to Acme Holdings LLC for curb repair.",
          "Contract 2024-19",
        ),
      planner: async () => {
        const p = emptyPlan();
        p.summary = "follow reopened company";
        return p;
      },
      archives: async () => [],
    });

    assert.ok(
      searched.some((q) => /acme holdings/i.test(q) || /2024-19/i.test(q)),
      searched.join(" | "),
    );
    const after = await sql<{ status: string }>`
      select status from frontier_items
      where investigation_id = ${id} and user_id = ${user} and label = ${"Acme Holdings LLC"}
    `;
    assert.notEqual(after[0]?.status, "exhausted");
  });

  it("a failed search provider does not exhaust the frontier; the next provider's hits are used", async () => {
    const user = `nongate-provider-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Provider fail");
    await persistDiscovery(user, id, {
      kind: "company",
      label: "Front Range Municipal Solutions LLC",
      why: "Named in a council packet",
      evidence: "Council packet award line.",
      priority: 10,
    });

    const result = await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      searchAttempt: async (q) => ({
        state: "SEARCH_SUCCESS_RESULTS",
        provider: "bing-html",
        hits: [
          {
            title: "FRMS filing",
            url: "https://www.sos.state.co.us/biz/frms",
            snippet: q,
          },
        ],
        lineage: [
          { state: "SEARCH_FAILED_NETWORK", hits: [], provider: "ddg-html", error: "timeout" },
          { state: "SEARCH_FAILED_PROVIDER", hits: [], provider: "ddg-lite", error: "500" },
          {
            state: "SEARCH_SUCCESS_RESULTS",
            provider: "bing-html",
            hits: [
              {
                title: "FRMS filing",
                url: "https://www.sos.state.co.us/biz/frms",
                snippet: q,
              },
            ],
          },
        ],
      }),
      fetch: async () =>
        fetchOk(
          "Front Range Municipal Solutions LLC. Principal: Jane Smith.",
          "FRMS filing",
        ),
      planner: async () => {
        const p = emptyPlan();
        p.summary = "search the company";
        return p;
      },
      archives: async () => [],
    });

    const attempts = await sql<{ provider: string; state: string }>`
      select provider, state from search_attempts
      where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(attempts.some((a) => a.provider === "ddg-html" && a.state.includes("FAILED")));
    assert.ok(attempts.some((a) => a.provider === "bing-html" && a.state.includes("SUCCESS")));

    const frontier = await sql<{ status: string; label: string }>`
      select status, label from frontier_items
      where investigation_id = ${id} and user_id = ${user}
        and label = ${"Front Range Municipal Solutions LLC"}
    `;
    assert.ok(frontier[0]);
    assert.notEqual(frontier[0]!.status, "exhausted");
    assert.notEqual(frontier[0]!.status, "dead-end");
    assert.ok(result.artifacts >= 1);
  });

  it("one zero-result query does not exhaust the subject; remaining strategies continue", async () => {
    const user = `nongate-zero-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Zero query");
    const label = "Peak Range Holdings LLC";
    await persistDiscovery(user, id, {
      kind: "company",
      label,
      why: "Named in a packet",
      evidence: "Packet names Peak Range Holdings LLC.",
      priority: 10,
    });

    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async () => [],
      fetch: async () => ({ ok: false, status: 404, text: "", title: "n", extras: [] }),
      planner: async () => {
        const p = emptyPlan();
        p.summary = "first tactic only";
        return p;
      },
      archives: async () => [],
    });

    const row = await sql<{
      status: string;
      search_zero_count: number | null;
      strategies_tried: string | null;
      next_steps: string;
    }>`
      select status, search_zero_count, strategies_tried, next_steps
      from frontier_items
      where investigation_id = ${id} and user_id = ${user} and label = ${label}
    `;
    assert.ok(row[0]);
    assert.notEqual(row[0]!.status, "exhausted");
    assert.ok((row[0]!.search_zero_count ?? 0) >= 1);
    const tried = JSON.parse(row[0]!.strategies_tried || "[]") as string[];
    const remaining = remainingStrategies("company", label, tried);
    assert.ok(remaining.length > 0, `remaining should be non-empty, tried=${tried.join(",")}`);
    assert.ok(row[0]!.next_steps.length > 0);
  });

  it("missing provenance is stored unresolved and the clue stays on the frontier", async () => {
    const user = `nongate-prov-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Provenance");

    await researchLoop({
      userId: user,
      investigationId: id,
      hops: 1,
      search: async () => [],
      fetch: async () => ({ ok: false, status: 404, text: "", title: "n", extras: [] }),
      planner: async () => {
        const p = emptyPlan();
        p.claims.push({
          text: "An unnamed staff memo may describe a side agreement on the water plant",
          kind: "HYPOTHESIS",
          evidence: "Heard in public comment; no packet page cited yet",
          confidence: 0.2,
        });
        p.summary = "clue without artifact";
        return p;
      },
      archives: async () => [],
    });

    const claims = await sql<{
      body: string;
      kind: string;
      provenance_status: string | null;
      version_id: number | null;
    }>`
      select body, kind, provenance_status, version_id from claims
      where investigation_id = ${id} and user_id = ${user}
    `;
    assert.equal(claims.length, 1);
    assert.equal(claims[0]!.kind, "HYPOTHESIS");
    assert.equal(claims[0]!.provenance_status, "unresolved");
    assert.equal(claims[0]!.version_id, null);

    const frontier = await sql<{ label: string; kind: string; status: string }>`
      select label, kind, status from frontier_items
      where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(
      frontier.some(
        (f) =>
          f.kind === "unresolved-provenance" || /side agreement|water plant/i.test(f.label),
      ),
      frontier.map((f) => f.label).join(" | "),
    );
    assert.ok(frontier.every((f) => f.status !== "dead-end"));
  });

  it("hop budget pauses remaining work and continuation resumes the leftover URL", async () => {
    const user = `nongate-budget-${Date.now()}`;
    const { sql, id } = await bootInv(user, "Budget");
    const pages = [
      "https://longmontcolorado.gov/p/one.html",
      "https://longmontcolorado.gov/p/two.html",
      "https://longmontcolorado.gov/p/three.html",
      "https://longmontcolorado.gov/p/four.html",
      "https://longmontcolorado.gov/p/five.html",
    ];
    const bodies: Record<string, string> = {
      [pages[0]!]: "Page one of the sidewalk file. ".repeat(8),
      [pages[1]!]: "Page two of the sidewalk file. ".repeat(8),
      [pages[2]!]: "Page three of the sidewalk file. ".repeat(8),
      [pages[3]!]: "Page four of the sidewalk file. ".repeat(8),
      [pages[4]!]:
        "Page five names October Civic Partners LLC as the remaining bidder on RFP 2024-22.",
    };

    const run = (hops: number, planner: () => HopPlan) =>
      researchLoop({
        userId: user,
        investigationId: id,
        hops,
        search: async () => [],
        fetch: async (url) => {
          const text = bodies[url];
          if (!text) return { ok: false, status: 404, text: "", title: "n", extras: [] };
          return fetchOk(text, url);
        },
        planner: async () => planner(),
        archives: async () => [],
      });

    const first = await run(1, () => {
      const p = emptyPlan();
      p.fetch_urls = pages;
      p.summary = "fetch the packet pages";
      return p;
    });
    assert.equal(first.paused, true);
    assert.ok(first.frontier > 0);

    const inv1 = await sql<{ status: string; pause_reason: string | null; hops: number }>`
      select status, pause_reason, hops from investigations where id = ${id} and user_id = ${user}
    `;
    assert.equal(inv1[0]!.status, "paused");
    assert.match(inv1[0]!.pause_reason ?? "", /Hop budget/i);
    assert.match(inv1[0]!.pause_reason ?? "", /pauses work/i);

    const arts1 = await sql<{ url: string }>`
      select url from artifacts where investigation_id = ${id} and user_id = ${user}
    `;
    const missing = pages.filter((u) => !arts1.some((a) => a.url === u));
    assert.ok(missing.length >= 1, "budget must leave at least one page unfetched");
    assert.ok(
      !arts1.some((a) => /October Civic Partners/i.test(a.url)) &&
        !arts1.some((a) => a.url === pages[4]),
      "the fifth page should wait for continuation",
    );

    const second = await run(1, () => {
      const p = emptyPlan();
      p.summary = "resume leftover fetches";
      return p;
    });

    const arts2 = await sql<{ url: string; full_text: string }>`
      select url, full_text from artifacts where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(
      pages.every((u) => arts2.some((a) => a.url === u)),
      arts2.map((a) => a.url).join("\n"),
    );
    assert.ok(arts2.some((a) => /October Civic Partners LLC/i.test(a.full_text)));
    assert.ok(second.hops >= 1);

    const frontier = await sql<{ label: string }>`
      select label from frontier_items where investigation_id = ${id} and user_id = ${user}
    `;
    assert.ok(
      frontier.some((f) => /October Civic Partners LLC/i.test(f.label)),
      frontier.map((f) => f.label).join(" | "),
    );
  });
});
