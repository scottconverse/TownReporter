import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_RESEARCH_CEILING_DEFAULT_MS,
  DESK_RESEARCH_HOP_BACKSTOP,
  DESK_RESEARCH_PAGE_CEILING_DEFAULT,
  DESK_RESEARCH_STAGE,
  boundedDeskQueries,
  collectLocalRecords,
  deskResearchCeilingMs,
  deskResearchPageCeiling,
  parseDeskPlan,
  parseDeskQueries,
  runDeskResearch,
  stopSentence,
  type DeskLocalRecords,
  type DeskReading,
  type DeskResearchDeps,
} from "./editorial-research.server.ts";
import { DESK_FINDINGS_ASK, DESK_PLAN_ASK, DESK_STOPPING_CONDITIONS } from "./editorial.ts";
import { JobCancelledError } from "./jobs.ts";
import type { Sql } from "../db.ts";

/*
  UNIT U30 + U31 -- the desk-run research pass, exercised without a socket, a
  model or a database.

  Every effect the pass has arrives through `DeskResearchDeps`, so these tests
  are the real loop: the real ceiling arithmetic, the real `junkQueryReason` and
  `boilerplatePageReason` refusals, the real `readableCapture` bar, the real
  Stop seam. What is faked is the outside world -- the search provider, the page
  fetch, the capture write, the newsroom's own record and the two model calls.

  TWO PROPERTIES ARE THE POINT OF U31, and both are asserted as behaviour here:

    - the research calls HOLD THE VOICE (they are handed it as their system
      message, exactly as the writing call is), which is what lets the model
      follow the protocol it is supposed to follow; and
    - research is NOT CAPPED at a fixed number of searches. It runs until the
      model, holding that protocol, says its stopping conditions are met -- or
      until the safety ceiling. A re-introduced "six searches" fails the test
      named for it below.
*/

/** The operator's voice file, as the research calls receive it. */
const VOICE = "THE EDITORIAL VOICE. The research protocol: Stage L local record first, then triangulation.";

const INPUT = {
  userId: "editor-1",
  newsroomId: 1,
  subject: "Front Range Passenger Rail sales tax",
  askedFor: "Whether a second district is needed for the same tracks",
  voice: VOICE,
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

/** A newsroom record the fake desk already holds. */
function fakeLocal(reading: DeskReading[], notes = "THE CITY'S OWN PORTAL: nothing naming this subject.") {
  return async (): Promise<DeskLocalRecords> => ({ notes, reading });
}

const EMPTY_LOCAL = fakeLocal([]);

/**
 * A desk pass whose outside world all works.
 *
 * `stopAfter` is the round at which the planner starts answering `stop: true`,
 * which is how the model's own stopping decision is simulated. It defaults to
 * round 1 so a test that only wants the loop to run once gets that.
 */
function healthyDeps(
  recorded: Recorded,
  over: Partial<DeskResearchDeps> = {},
  stopAfter = 1,
): DeskResearchDeps {
  let captures = 0;
  let rounds = 0;
  return {
    readWindow: async () => null,
    localRecords: EMPTY_LOCAL,
    onStage: async (stage) => {
      recorded.stages.push(stage);
    },
    plan: async (system, pack) => {
      rounds += 1;
      recorded.planSystems.push(system);
      recorded.planPacks.push(pack);
      return {
        ok: true,
        text: JSON.stringify({
          queries: [`rail district levy r${rounds}`, `district board minutes r${rounds}`],
          stop: rounds >= stopAfter,
          reason: rounds >= stopAfter ? "two independent sources on every claim" : "",
        }),
      };
    },
    search: async (query) => {
      recorded.searches.push(query);
      const slug = query.replace(/\s+/g, "-");
      return {
        hits: [
          { title: `Levy record (${slug})`, url: `https://longmontcolorado.gov/${slug}`, snippet: "" },
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
      return { ok: true, text: `The levy is four tenths of a cent — https://longmontcolorado.gov/x` };
    },
    ...over,
  };
}

describe("the research calls hold the voice, like the writing call does", () => {
  it("hands the voice file to the planner and the reader as their system message", async () => {
    const recorded = recorder();
    await runDeskResearch(INPUT, healthyDeps(recorded));

    assert.equal(recorded.planSystems.length, 1);
    assert.equal(recorded.readSystems.length, 1);
    for (const system of recorded.planSystems) assert.equal(system, VOICE);
    for (const system of recorded.readSystems) assert.equal(system, VOICE);

    // The arrival sentence is the job's own stage-list phrase, and it is what
    // lights the "Researching with the desk" chip (see `JOB_STAGE_LISTS`).
    assert.equal(recorded.stages[0], DESK_RESEARCH_STAGE);
    assert.ok(recorded.stages.some((stage) => /^Researching with the desk: /.test(stage)));
  });

  it("states the desk's ask and the protocol's stopping conditions in the pack", async () => {
    const recorded = recorder();
    await runDeskResearch(INPUT, healthyDeps(recorded));

    assert.match(recorded.planPacks[0]!, /THE DESK'S REQUEST/);
    assert.ok(recorded.planPacks[0]!.startsWith(DESK_PLAN_ASK));
    assert.match(recorded.planPacks[0]!, /STOPPING CONDITIONS/);
    assert.ok(recorded.planPacks[0]!.includes(DESK_STOPPING_CONDITIONS));
    assert.match(recorded.planPacks[0]!, /two\s+independent sources/);
    assert.match(recorded.planPacks[0]!, /local primary document/);
    assert.ok(recorded.readPacks[0]!.startsWith(DESK_FINDINGS_ASK));
  });
});

describe("research runs until the protocol says stop, not until a count is spent", () => {
  /*
    THE MUTATION TARGET. U31 removed the six-search budget, and this is the test
    that says so: a planner that keeps finding unsettled work keeps getting
    searched until the model itself stops. Put a `searches < 6` back in the loop
    and the counts below collapse to six and this fails.
  */
  it("keeps going past six searches until the model's stopping conditions are met", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(
      INPUT,
      healthyDeps(recorded, { pageCeiling: 100 }, 8),
    );

    assert.equal(out.stopReason, "protocol-satisfied");
    assert.ok(out.searches > 6, `research must not be capped at six searches; ran ${out.searches}`);
    assert.equal(out.searches, 16, "two queries a round for the eight rounds the planner asked for");
    assert.equal(out.pages, 16);
    assert.equal(out.stopDetail, "two independent sources on every claim");
  });

  it("honours the model's stop after the round it names, and says why in its own words", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, healthyDeps(recorded, {}, 3));

    assert.equal(out.stopReason, "protocol-satisfied");
    assert.equal(out.searches, 6, "three rounds of two: the model's own decision, not a cap");
    assert.equal(out.stopDetail, "two independent sources on every claim");
    assert.ok(recorded.stages.some((s) => /stopped — the protocol's stopping conditions were met/.test(s)));
  });
});

describe("the ceiling is a safety net, not a research budget", () => {
  it("stops at the page ceiling when the model never says stop", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, healthyDeps(recorded, { pageCeiling: 9 }, 999));

    assert.equal(out.stopReason, "page-ceiling");
    assert.equal(out.pages, 9);
    assert.ok(recorded.stages.some((s) => /the page ceiling was reached/.test(s)));
  });

  it("stops at the time ceiling when the model never says stop", async () => {
    const recorded = recorder();
    let clock = 0;
    const out = await runDeskResearch(
      INPUT,
      healthyDeps(
        recorded,
        {
          ceilingMs: 60_000,
          // Every check advances the clock past the ceiling: the first hop's
          // planning call is what a real slow provider spends its time in.
          now: () => new Date(clock),
          search: async (query) => {
            recorded.searches.push(query);
            clock += 40_000;
            return { hits: [], decision: "not-evaluated" };
          },
        },
        999,
      ),
    );

    assert.equal(out.stopReason, "time-ceiling");
    assert.ok(recorded.stages.some((s) => /the research time ceiling was reached/.test(s)));
  });

  /*
    L1 of the batch-7 pre-merge audit: the ceiling was tested per hop and per
    query, and a query's own page reads sat inside that. Four hits, each with
    its own fetch timeout, is the ceiling spent in a loop that never asked.

    THE MUTATION: deleting the clock check from the hit loop makes this read all
    three pages and report the model's stop instead of the ceiling.
  */
  it("checks the clock between the pages of ONE query, not only between queries", async () => {
    const recorded = recorder();
    let clock = 0;
    const out = await runDeskResearch(
      INPUT,
      healthyDeps(
        recorded,
        {
          ceilingMs: 60_000,
          now: () => new Date(clock),
          search: async (query) => {
            recorded.searches.push(query);
            return {
              hits: [1, 2, 3].map((n) => ({
                title: `Levy record ${n}`,
                url: `https://longmontcolorado.gov/levy-${n}`,
                snippet: "",
              })),
              decision: "relevant" as const,
            };
          },
          // Time is spent READING, which is where a slow day's minutes go.
          fetch: async (url) => {
            recorded.fetched.push(url);
            clock += 40_000;
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
        },
        999,
      ),
    );

    assert.equal(out.stopReason, "time-ceiling");
    assert.equal(
      recorded.fetched.length,
      2,
      `the third page was read after the ceiling had already passed: ${recorded.fetched.join(" | ")}`,
    );
    assert.ok(recorded.stages.some((s) => /the research time ceiling was reached/.test(s)));
  });

  /*
    The other half of L1: the PrimeGov packet loop, inside `collectLocalRecords`.

    Nothing here opens a socket: `io.readPortal` is the portal seam (the real
    reader resolves a public hostname, so a test cannot reach it offline), and
    the packet reads go through the injected `fetchPage`, which is where this
    test spends the clock. Two meetings qualify, one document each; without the
    check the desk reads both packets and the ceiling is discovered one page
    late.
  */
  it("stops reading PrimeGov packets for ONE query when the clock has run out", async () => {
    const meeting = (id: number, title: string) => ({
      id,
      title,
      date: "Aug 25, 2026",
      dateTime: "2026-08-25T19:00:00",
      time: "07:00 PM",
      location: "",
      documentList: [{ id, templateId: 16375, compileOutputType: 1, templateName: "Packet", link: null }],
    });
    const clock = { at: 0 };
    const fetched: string[] = [];
    const reading: DeskReading[] = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>() =>
      [{ url: "https://boulder.primegov.com/public/portal" }] as T[];

    const out = await collectLocalRecords(
      {
        userId: "editor-1",
        newsroomId: 7,
        subject: "Levy district",
        officialHosts: [],
        pageCeiling: DESK_RESEARCH_PAGE_CEILING_DEFAULT,
      },
      {
        fetchPage: async (url) => {
          fetched.push(url);
          // One packet's read spends the whole thirty minutes: the next meeting
          // must not be opened at all.
          clock.at += 60_000;
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
        capture: async () => ({ captureEventId: 1, versionId: 2 }),
        reading,
        onStage: async () => undefined,
        throwIfCancelled: async () => undefined,
        expired: () => clock.at >= 60_000,
        readPortal: async () => ({
          ok: true,
          status: 0,
          failure: null,
          meetings: [
            meeting(3700, "Levy district council session"),
            meeting(3701, "Levy district board session"),
          ],
        }),
        sql,
      },
    );

    // One note, for the portal the desk actually read, naming both meetings.
    assert.match(out.notes, /OWN PORTAL \(PrimeGov, https:\/\/boulder\.primegov\.com\): 2 meetings/);
    assert.equal(
      fetched.length,
      1,
      `a packet was read after the ceiling had passed: ${fetched.join(" | ")}`,
    );
  });

  it("has generous, configurable defaults and refuses a typo", () => {
    assert.equal(deskResearchCeilingMs(), DESK_RESEARCH_CEILING_DEFAULT_MS);
    assert.equal(deskResearchPageCeiling(), DESK_RESEARCH_PAGE_CEILING_DEFAULT);
    assert.equal(DESK_RESEARCH_CEILING_DEFAULT_MS, 1_800_000, "thirty minutes");
    assert.equal(DESK_RESEARCH_PAGE_CEILING_DEFAULT, 80);

    const beforeMs = process.env.EDITORIAL_RESEARCH_CEILING_MS;
    const beforePages = process.env.EDITORIAL_RESEARCH_PAGE_CEILING;
    try {
      process.env.EDITORIAL_RESEARCH_CEILING_MS = "7200000";
      process.env.EDITORIAL_RESEARCH_PAGE_CEILING = "200";
      assert.equal(deskResearchCeilingMs(), 7_200_000);
      assert.equal(deskResearchPageCeiling(), 200);
      // A typo, and a value under the floor, both fall back rather than
      // forbidding every run.
      process.env.EDITORIAL_RESEARCH_CEILING_MS = "half an hour";
      process.env.EDITORIAL_RESEARCH_PAGE_CEILING = "0";
      assert.equal(deskResearchCeilingMs(), DESK_RESEARCH_CEILING_DEFAULT_MS);
      assert.equal(deskResearchPageCeiling(), DESK_RESEARCH_PAGE_CEILING_DEFAULT);
    } finally {
      if (beforeMs === undefined) delete process.env.EDITORIAL_RESEARCH_CEILING_MS;
      else process.env.EDITORIAL_RESEARCH_CEILING_MS = beforeMs;
      if (beforePages === undefined) delete process.env.EDITORIAL_RESEARCH_PAGE_CEILING;
      else process.env.EDITORIAL_RESEARCH_PAGE_CEILING = beforePages;
    }
  });

  it("stops when the planner has no more usable search, and never spins past its backstop", async () => {
    const recorded = recorder();
    let rounds = 0;
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded, {}, 999),
      plan: async (_system, pack) => {
        rounds += 1;
        recorded.planPacks.push(pack);
        // Same query every round: the desk refuses to ask it twice, so the run
        // ends on "nothing further to search" rather than on the backstop.
        return { ok: true, text: JSON.stringify({ queries: ["rail district levy"], stop: false }) };
      },
    });

    assert.equal(out.stopReason, "no-more-queries");
    assert.deepEqual(recorded.searches, ["rail district levy"]);
    assert.ok(rounds < DESK_RESEARCH_HOP_BACKSTOP, "the backstop is a backstop, not the usual end");
  });
});

describe("the newsroom's own record is read before any general web search", () => {
  const CAPTURED: DeskReading = {
    kind: "page",
    title: "Board minutes",
    url: "https://longmontcolorado.gov/minutes",
    captureEventId: 7,
    versionId: 9,
    locator: null,
    text: "The board approved the levy on a 5-2 vote.",
  };

  it("gives the planner the local record, and the reader the local reading", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(
      INPUT,
      healthyDeps(recorded, {
        localRecords: fakeLocal(
          [{ ...CAPTURED, kind: "transcript", locator: "00:12:30" }],
          "THE CITY'S OWN PORTAL (PrimeGov): 12 meetings, the levy named in two.",
        ),
      }),
    );

    assert.match(recorded.planPacks[0]!, /THE NEWSRROOM'S OWN RECORD, READ FIRST/);
    assert.match(recorded.planPacks[0]!, /THE CITY'S OWN PORTAL \(PrimeGov\): 12 meetings/);
    assert.match(recorded.readPacks[0]!, /\[00:12:30 https:\/\/longmontcolorado\.gov\/minutes\]/);
    assert.equal(out.pages, 3, "the local record counts as read, beside the two pages searched");
  });

  it("names the official hosts in the pack and ranks them through the relevance contract", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, healthyDeps(recorded));
    assert.match(recorded.planPacks[0]!, /THE PAPER'S OWN OFFICIAL HOSTS: longmontcolorado\.gov/);
    assert.equal(out.window, null, "no window set: no date operator is invented");
    assert.ok(recorded.searches.every((q) => !/\bafter:|\bbefore:/.test(q)));
  });

  /*
    The protocol's local-record order, made literal: the paper's own site is
    searched BEFORE anything the model names, so the desk's first look is at the
    record rather than at coverage of it.
  */
  it("searches the paper's own official site before any query the model names", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(
      {
        ...INPUT,
        // The city's own site, as the newsroom's settings supply it
        // (`officialSiteHost`). `officialDomains` above is the .gov list
        // derived from the editor's pointers, which is a different list.
        paper: { ...INPUT.paper, officialHosts: ["longmontcolorado.gov"] },
      },
      healthyDeps(recorded),
    );

    assert.match(recorded.searches[0]!, /^site:longmontcolorado\.gov /);
    assert.match(recorded.searches[0]!, /passenger rail sales/);
    assert.deepEqual(
      recorded.searches.slice(1),
      ["rail district levy r1", "district board minutes r1"],
      "everything the model named comes after the paper's own site",
    );
    assert.equal(out.pages, 3, "the official site's page, plus the round's two");
  });

  it("honours the editor's research window when the newsroom has one", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, {
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
    });

    assert.equal(out.window, "2026-01-01 through 2026-09-30");
    assert.match(recorded.planPacks[0]!, /THE EDITOR'S RESEARCH WINDOW: 2026-01-01 through 2026-09-30/);
    assert.ok(
      recorded.searches.every((q) => /after:2025-12-31 before:2026-10-01/.test(q)),
      recorded.searches.join(" | "),
    );
  });
});

describe("the desk refuses what is not a search and what is not a page", () => {
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
            stop: true,
          }),
        };
      },
    });

    assert.deepEqual(recorded.searches, ["rail district levy"]);
    assert.ok(!recorded.searches.some((q) => /https?:\/\/|—/.test(q)));
  });

  it("drops a capture it could not read, and never hands the reader a paywall notice", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      fetch: async (url) => {
        recorded.fetched.push(url);
        return {
          ok: false,
          status: 403,
          outcome: "fetch-failed",
          title: "Just a moment…",
          text: "Enable JavaScript and cookies to continue",
          pages: [],
          extractionMethod: "html",
        };
      },
    });

    assert.equal(out.pages, 0);
    assert.equal(recorded.captured.length, 0);
    assert.ok(!recorded.readPacks.some((pack) => /Enable JavaScript/.test(pack)));
  });
});

describe("the desk's research can be stopped, and can come back empty", () => {
  /*
    The U25 seam. It THROWS, so a stopped run leaves the loop instead of looking
    like a run that finished with nothing -- and the piece is never written,
    because the writing call is downstream of this pass.
  */
  it("ends the run cancelled when the editor presses Stop during research", async () => {
    const recorded = recorder();
    let checks = 0;
    await assert.rejects(
      () =>
        runDeskResearch(INPUT, {
          ...healthyDeps(recorded, {}, 999),
          throwIfCancelled: async () => {
            checks += 1;
            if (checks >= 6) throw new JobCancelledError();
          },
        }),
      (error: unknown) => error instanceof JobCancelledError,
    );
    assert.equal(recorded.readSystems.length, 0, "the reading call never ran");
  });

  it("says honestly that nothing was found, and does not throw", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded, {}, 3),
      search: async (query) => {
        recorded.searches.push(query);
        return { hits: [], decision: "not-evaluated" };
      },
    });

    assert.equal(out.pages, 0);
    assert.equal(out.findings, "");
    assert.match(out.nothingFoundReason ?? "", /ran 6 searches and read no page/);
    assert.equal(recorded.readSystems.length, 0, "there is nothing to read");
    assert.ok(recorded.stages.some((stage) => /nothing usable/.test(stage)) === false);
  });

  it("names the relevance contract's own complaint when results were degraded", async () => {
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
    assert.match(out.nothingFoundReason ?? "", /ran 2 searches/);
    assert.match(out.nothingFoundReason ?? "", /none matched enough/);
  });

  it("plans nothing at all when the planner cannot answer, and still reports", async () => {
    const recorded = recorder();
    const out = await runDeskResearch(INPUT, {
      ...healthyDeps(recorded),
      plan: async () => ({ ok: false, error: "LLM is unreachable." }),
    });
    assert.equal(out.searches, 0);
    assert.equal(out.stopReason, "planner-failed");
    assert.equal(out.stopDetail, "LLM is unreachable.");
    assert.match(out.nothingFoundReason ?? "", /planned no usable search/);
  });
});

describe("the planner's answer is read tolerantly", () => {
  it("reads the plan out of a fenced block, a bare object or a bare array", () => {
    const fenced = parseDeskPlan('```json\n{"queries": ["a", "b"], "stop": true, "reason": "done"}\n```');
    assert.deepEqual(fenced, { queries: ["a", "b"], stop: true, reason: "done" });
    assert.deepEqual(parseDeskPlan('{"queries": ["a"]}'), { queries: ["a"], stop: false, reason: "" });
    assert.deepEqual(parseDeskPlan('["a", "b"]').queries, ["a", "b"]);
    assert.deepEqual(parseDeskQueries("- levy record\n- board minutes"), ["levy record", "board minutes"]);
    assert.deepEqual(parseDeskQueries(""), []);
  });

  it("drops the junk, de-duplicates, and imposes no cap of its own", () => {
    const tried = new Set<string>();
    const first = boundedDeskQueries(
      ["Levy record — longmontcolorado.gov", "rail district levy", "Rail District Levy", "https://x.test/a", "second query"],
      { tried },
    );
    assert.deepEqual(first, ["rail district levy", "second query"]);
    assert.deepEqual(
      boundedDeskQueries(["rail district levy", "another"], { tried }),
      ["another"],
      "a query already asked on an earlier round is not asked again",
    );
    const many = Array.from({ length: 40 }, (_, i) => `query number ${i}`);
    assert.equal(
      boundedDeskQueries(many, { tried: new Set() }).length,
      40,
      "the reader imposes no search cap; the loop's ceiling is what bounds it",
    );
  });

  it("says each stop reason in one clause", () => {
    assert.match(stopSentence("protocol-satisfied", 9, 12), /stopping conditions were met \(9 searches, 12 pages\)/);
    assert.match(stopSentence("time-ceiling", 1, 1), /time ceiling was reached \(1 search, 1 page\)/);
    assert.match(stopSentence("no-more-queries", 2, 0), /no further usable search was planned/);
  });
});
