import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_RESEARCH_PAGES,
  DESK_RESEARCH_SEARCHES,
  DESK_RESEARCH_STAGE,
  boundedDeskQueries,
  parseDeskQueries,
  runDeskResearch,
  type DeskResearchDeps,
} from "./editorial-research.server.ts";
import {
  DESK_PLANNER_INSTRUCTIONS,
  DESK_READER_INSTRUCTIONS,
  buildDeskFindingsPack,
  buildDeskPlanPack,
} from "./editorial.ts";
import { JobCancelledError } from "./jobs.ts";

/*
  UNIT U30 -- the desk-run research pass, exercised without a socket, a model
  or a database.

  Every effect the pass has arrives through `DeskResearchDeps`, so these tests
  are the real loop: the real hop budget, the real `junkQueryReason` and
  `boilerplatePageReason` refusals, the real `readableCapture` bar, the real
  Stop seam. What is faked is the outside world -- the search provider, the
  page fetch, the capture write and the two no-tool model calls -- which is
  exactly the split the pass was built with.

  The SEC-3 half (the research calls must never carry the voice) is asserted
  one level up, in ./editorial.test.ts, where `writeEditorial` is driven with a
  recorder on the same transport the writing call uses.
*/

const INPUT = {
  userId: "editor-1",
  newsroomId: 1,
  subject: "Front Range Passenger Rail sales tax",
  askedFor: "Whether a second district is needed for the same tracks",
  researchPack:
    "SUBJECT: Front Range Passenger Rail sales tax\n\nDOCUMENT POINTERS FROM THE DESK (unverified leads, open them yourself):\n- SB21-238",
  paper: { city: "Longmont", state: "Colorado", officialDomains: ["longmontcolorado.gov"] },
  requestId: 12,
};

const READABLE_BODY =
  "The district's own referral resolution lists the levy at four tenths of a cent " +
  "and names the corridors it would fund, which is the record the editorial cites.";

type Recorded = {
  searches: string[];
  fetched: string[];
  captured: { url: string; title: string }[];
  planPacks: string[];
  readPacks: string[];
  planSystems: string[];
  readSystems: string[];
  stages: string[];
};

function recorder(): Recorded {
  return {
    searches: [],
    fetched: [],
    captured: [],
    planPacks: [],
    readPacks: [],
    planSystems: [],
    readSystems: [],
    stages: [],
  };
}

/** A desk pass whose outside world all works, with one query per hop. */
function healthyDeps(recorded: Recorded, over: Partial<DeskResearchDeps> = {}): DeskResearchDeps {
  let captures = 0;
  return {
    readWindow: async () => null,
    onStage: async (stage) => {
      recorded.stages.push(stage);
    },
    // Hop 1 and hop 2 plan different queries, so the hop-2 round is not
    // swallowed by the "already asked" de-duplication.
    plan: async (system, pack) => {
      recorded.planSystems.push(system);
      recorded.planPacks.push(pack);
      const hop = /PLANNING HOP (\d)/.exec(pack)?.[1] ?? "1";
      return { ok: true, text: `{"queries": ["rail district levy hop${hop}", "district board minutes hop${hop}"]}` };
    },
    search: async (query) => {
      recorded.searches.push(query);
      const slug = query.replace(/\s+/g, "-");
      return {
        hits: [
          { title: `Levy record (${slug})`, url: `https://longmontcolorado.gov/${slug}`, snippet: "" },
          { title: `Board minutes (${slug})`, url: `https://leg.colorado.gov/${slug}`, snippet: "" },
        ],
        decision: "relevant",
      };
    },
    fetch: async (url) => {
      recorded.fetched.push(url);
      return {
        ok: true,
        status: 200,
        outcome: "fetched",
        title: `Page at ${url}`,
        text: READABLE_BODY,
        pages: [],
        extractionMethod: "html",
      };
    },
    capture: async (page) => {
      captures += 1;
      recorded.captured.push({ url: page.url, title: page.title });
      return { captureEventId: 100 + captures, versionId: 200 + captures };
    },
    read: async (system, pack) => {
      recorded.readSystems.push(system);
      recorded.readPacks.push(pack);
      return {
        ok: true,
        text: "The levy is four tenths of a cent — https://longmontcolorado.gov/levy (read from the desk's capture).",
      };
    },
    ...over,
  };
}

describe("the desk researches for a writer that has no web tools", () => {
  it("plans, searches, reads and captures, and returns findings with the URLs", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, healthyDeps(recorded));

    assert.equal(out.pages, 8, "two hops of two queries of two hits fills the page budget");
    assert.equal(out.searches, 4, "four of the six searches are spent");
    assert.equal(out.captures.length, 8);
    assert.match(out.findings, /longmontcolorado\.gov/);
    assert.equal(out.nothingFoundReason, null);
    assert.deepEqual(recorded.fetched.length, 8);
    assert.equal(
      out.captures[0]!.captureEventId,
      101,
      "every capture keeps the id the artifact table gave it, for the appendix to cite",
    );

    // The arrival, in the exact words the job's stage list carries.
    assert.equal(recorded.stages[0], DESK_RESEARCH_STAGE);
    assert.ok(recorded.stages.some((s) => /search 1 of 6/.test(s)));
  });

  it("gives the reading call the captured pages, and never a page's text to the planner", async () => {
    const recorded = recorder();
    await runDeskResearch(INPUT, healthyDeps(recorded));

    assert.equal(recorded.planSystems.length, 2, "one planning call per hop");
    assert.equal(recorded.readSystems.length, 1, "one reading call over both hops");
    for (const system of recorded.planSystems) assert.equal(system, DESK_PLANNER_INSTRUCTIONS);
    for (const system of recorded.readSystems) assert.equal(system, DESK_READER_INSTRUCTIONS);

    // The planner is choosing where to search: it gets the desk's material and
    // the addresses already captured, not the pages themselves.
    assert.match(recorded.planPacks[0]!, /DOCUMENT POINTERS FROM THE DESK/);
    assert.doesNotMatch(recorded.planPacks[0]!, /four tenths of a cent/);
    assert.match(recorded.planPacks[1]!, /PAGES ALREADY CAPTURED/);
    assert.match(recorded.planPacks[1]!, /longmontcolorado\.gov\/rail-district-levy-hop1/);

    // The reader gets the pages, each with the identity the appendix cites.
    assert.match(recorded.readPacks[0]!, /\[capture:101 https:\/\/longmontcolorado\.gov\//);
    assert.match(recorded.readPacks[0]!, /four tenths of a cent/);
  });

  it("tells the planner the paper's own official hosts and the editor's research window", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(
      {
        ...INPUT,
        // The city's own site comes from the newsroom's settings
        // (`officialSiteHost`), the .gov list from the editor's pointers; the
        // desk is told about both.
        paper: { ...INPUT.paper, officialHosts: ["longmontcolorado.gov"] },
      },
      {
        ...healthyDeps(recorded),
        readWindow: async () => ({
          mode: "range",
          lookbackDays: 90,
          startDate: "2026-01-01",
          endDate: "2026-09-30",
          verificationLimit: 6,
          executionMode: "batch",
          actionLimit: 6,
          capturedAt: "2026-09-30T00:00:00.000Z",
        }),
      },
    );

    assert.match(recorded.planPacks[0]!, /THE PAPER'S OWN OFFICIAL HOSTS: longmontcolorado\.gov/);
    assert.match(recorded.planPacks[0]!, /THE EDITOR'S RESEARCH WINDOW: 2026-01-01 through 2026-09-30/);
    assert.equal(out.window, "2026-01-01 through 2026-09-30");
    // Every query the desk actually runs carries the window, through the same
    // helper the dig uses.
    assert.ok(
      recorded.searches.every((q) => /after:2025-12-31 before:2026-10-01/.test(q)),
      recorded.searches.join(" | "),
    );
  });

  it("writes no date operator when the newsroom has never set a window", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, healthyDeps(recorded));
    assert.equal(out.window, null);
    assert.ok(recorded.searches.every((q) => !/\bafter:|\bbefore:/.test(q)));
  });
});

describe("the desk refuses what is not a search and what is not a page", () => {
  /*
    `junkQueryReason` is the desk's rule here, reused rather than re-invented
    (see its own doc comment for the measured defect it answers). It refuses the
    page-shaped queries -- a title welded to its host, a URL, scraped markup --
    and it does not refuse a long unquoted sentence: it judges the shapes a page
    leaks into a query, and a sentence is a query the PLANNER was told not to
    write. So the assertion is the property that matters, that neither junk
    shape reached a provider, not a claim that every bad query is caught.
  */
  it("never spends a search on a page title or a URL", async () => {
    const recorded = recorder();
    await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      plan: async (_system, pack) => {
        recorded.planPacks.push(pack);
        return {
          ok: true,
          text: JSON.stringify({
            queries: [
              "Levy record — longmontcolorado.gov",
              "https://longmontcolorado.gov/levy",
              "rail district levy",
            ],
          }),
        };
      },
    });

    assert.deepEqual(recorded.searches.slice(0, 1), ["rail district levy"]);
    assert.ok(
      recorded.searches.every((q) => q === "rail district levy"),
      `only the usable query may reach a provider: ${recorded.searches.join(" | ")}`,
    );
    assert.ok(!recorded.searches.some((q) => /https?:\/\/|—/.test(q)));
  });

  it("drops a capture it could not read, and never hands the reader a paywall notice", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      fetch: async (url) => {
        recorded.fetched.push(url);
        return url.includes("levy")
          ? {
              ok: false,
              status: 403,
              outcome: "fetch-failed",
              title: "Just a moment…",
              text: "Enable JavaScript and cookies to continue",
              pages: [],
              extractionMethod: "html",
            }
          : {
              ok: true,
              status: 200,
              outcome: "fetched",
              title: "Board minutes",
              text: READABLE_BODY,
              pages: [],
              extractionMethod: "html",
            };
      },
    });

    assert.ok(out.pages > 0, "the readable pages still count");
    assert.ok(
      recorded.captured.every((c) => !c.url.includes("/rail-district-levy-hop")),
      "the blocked pages were never captured",
    );
    assert.ok(!recorded.readPacks.some((pack) => /Enable JavaScript/.test(pack)));
  });
});

describe("the desk's budget is a ceiling, not a target", () => {
  it("stops at two hops and eight pages", async () => {
    const recorded = recorder();
    let plans = 0;
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      // A planner that never runs out of new queries, and a search that never
      // runs out of hits: only the budget can stop this run.
      plan: async () => {
        plans += 1;
        const queries = Array.from({ length: 6 }, (_, i) => `query ${plans}-${i}`);
        return { ok: true, text: JSON.stringify({ queries }) };
      },
    });

    assert.equal(out.pages, DESK_RESEARCH_PAGES, "the page budget is what stopped this run");
    assert.ok(out.searches <= DESK_RESEARCH_SEARCHES, `searches: ${out.searches}`);
    assert.equal(plans, 2, "exactly two planning calls: hop 2 is the last hop");
  });

  it("stops at six searches even when nothing it reads counts", async () => {
    const recorded = recorder();
    let plans = 0;
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      plan: async () => {
        plans += 1;
        const queries = Array.from({ length: 6 }, (_, i) => `query ${plans}-${i}`);
        return { ok: true, text: JSON.stringify({ queries }) };
      },
      search: async (query) => {
        recorded.searches.push(query);
        return { hits: [], decision: "not-evaluated" };
      },
    });

    assert.equal(out.searches, DESK_RESEARCH_SEARCHES, "the search budget is the ceiling here");
    assert.equal(out.pages, 0);
    assert.equal(plans, 2);
  });

  it("stops when a hop yields no new usable query rather than re-asking", async () => {
    const recorded = recorder();
    let plans = 0;
    await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      plan: async () => {
        plans += 1;
        return { ok: true, text: JSON.stringify({ queries: ["rail district levy"] }) };
      },
    });
    assert.equal(plans, 2);
    assert.deepEqual(recorded.searches, ["rail district levy"], "the same query is never run twice");
  });
});

describe("the desk's research can be stopped, and can come back empty", () => {
  /*
    The U25 seam. It THROWS, so a stopped run leaves the hop loop instead of
    looking like a run that finished with nothing -- and the piece is never
    written, because the writing call is downstream of this pass.
  */
  it("ends the run cancelled when the editor presses Stop during research", async () => {
    const recorded = recorder();
    let checks = 0;
    await assert.rejects(
      () =>
        runDeskResearch(INPUT, {
          ...healthyDeps(recorded),
          throwIfCancelled: async () => {
            checks += 1;
            if (checks >= 3) throw new JobCancelledError();
          },
        }),
      (error: unknown) => error instanceof JobCancelledError,
    );
    assert.equal(recorded.captured.length, 0, "nothing was captured after the Stop");
    assert.equal(recorded.readSystems.length, 0, "and the reading call never ran");
  });

  it("says honestly that nothing was found when no page survives, and does not throw", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      search: async (query) => {
        recorded.searches.push(query);
        return { hits: [], decision: "not-evaluated" };
      },
    });

    assert.equal(out.pages, 0);
    assert.equal(out.captures.length, 0);
    assert.equal(out.findings, "");
    // Two usable queries per hop, and no page survives either round.
    assert.match(out.nothingFoundReason ?? "", /ran 4 searches and read no page/);
    assert.equal(recorded.readSystems.length, 0, "there is nothing to read");
    // The editor watching the row is told too, not just the writing model.
    assert.ok(
      recorded.stages.some((stage) => /nothing usable was found/.test(stage)),
      `stages: ${recorded.stages.join(" | ")}`,
    );
  });

  it("names the relevance contract's own complaint when every result set was degraded", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      search: async (query) => {
        recorded.searches.push(query);
        return {
          hits: [{ title: "Water damage", url: "https://example.com/water", snippet: "" }],
          decision: "degraded",
          reason: "Providers returned results, but none matched enough investigation-question terms.",
        };
      },
      fetch: async () => ({
        ok: true,
        status: 200,
        outcome: "fetched",
        title: "Water damage",
        text: "Short.",
        pages: [],
        extractionMethod: "html",
      }),
    });

    assert.equal(out.pages, 0);
    assert.match(out.nothingFoundReason ?? "", /ran 4 searches/);
    assert.match(out.nothingFoundReason ?? "", /none matched enough/);
  });

  it("plans no search at all when the planner cannot answer", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      plan: async () => ({ ok: false, error: "LLM is unreachable." }),
    });
    assert.equal(out.searches, 0);
    assert.match(out.nothingFoundReason ?? "", /planned no usable search/);
  });
});

describe("the planner's answer is read tolerantly and bounded hard", () => {
  it("reads JSON out of a fenced block, and a bare array", () => {
    assert.deepEqual(parseDeskQueries('```json\n{"queries": ["a", "b"]}\n```'), ["a", "b"]);
    assert.deepEqual(parseDeskQueries('{"queries": ["a"]}'), ["a"]);
    assert.deepEqual(parseDeskQueries('["a", "b"]'), ["a", "b"]);
    assert.deepEqual(parseDeskQueries('Here you go:\n{"queries": ["levy record"]}\nHope that helps'), [
      "levy record",
    ]);
    assert.deepEqual(parseDeskQueries("- levy record\n- board minutes"), ["levy record", "board minutes"]);
    assert.deepEqual(parseDeskQueries(""), []);
  });

  it("drops the junk, de-duplicates, and honours the cap", () => {
    const tried = new Set<string>();
    const first = boundedDeskQueries(
      ["Levy record — longmontcolorado.gov", "rail district levy", "Rail District Levy", "https://x.test/a", "second query"],
      { tried, cap: 3 },
    );
    assert.deepEqual(first, ["rail district levy", "second query"]);
    assert.deepEqual(
      boundedDeskQueries(["rail district levy", "another"], { tried, cap: 3 }),
      ["another"],
      "a query already asked on an earlier hop is not asked again",
    );
  });

  it("builds a plan pack that never repeats the page text it was shown", () => {
    const pack = buildDeskPlanPack({
      researchPack: "SUBJECT: The rail tax",
      hop: 2,
      hops: 2,
      tried: ["rail district levy"],
      captured: [{ title: "Levy record", url: "https://longmontcolorado.gov/levy" }],
      officialDomains: ["longmontcolorado.gov"],
    });
    assert.match(pack, /PLANNING HOP 2 OF 2/);
    assert.match(pack, /- rail district levy/);
    assert.match(pack, /Levy record — https:\/\/longmontcolorado\.gov\/levy/);
    assert.match(pack, /THE PAPER'S OWN OFFICIAL HOSTS: longmontcolorado\.gov/);
  });

  it("builds a findings pack that carries every capture's id and URL", () => {
    const pack = buildDeskFindingsPack({
      subject: "The rail tax",
      askedFor: "Whether it is needed",
      captures: [
        { url: "https://longmontcolorado.gov/levy", title: "Levy", captureEventId: 7, versionId: 9, text: "Text." },
      ],
    });
    assert.match(pack, /\[capture:7 https:\/\/longmontcolorado\.gov\/levy\]/);
    assert.match(pack, /WHAT THE EDITOR ASKED FOR: Whether it is needed/);
    assert.match(pack, /Text\./);
  });
});
