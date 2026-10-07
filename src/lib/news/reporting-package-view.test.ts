import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actionEvidenceLine,
  claimBadge,
  hasReportingPackage,
  heldLine,
  methodLine,
  packageGaps,
  readinessLabel,
  reportingRunState,
  scoreLine,
  sourceLocator,
} from "./reporting-package-view.ts";
import {
  parseReportingPackage,
  type CoverageAction,
  type PackageClaim,
  type PackageHeld,
  type PackageSource,
  type PackageStory,
  type ReportingPackage,
} from "./civic-reporting.ts";

/*
  The wording rules for the reporting package panel (reporting-package-view.ts).

  WHY THESE, AND WHY HERE. This panel is where the desk can most easily mislead an
  editor: by showing a claim as verified when the package only marked it so, by
  calling a COMPLETE run "ready to publish", or by drawing an unscored run as a row
  of zeros. Each of those has a test below. The functions are pure and live in a
  .ts on purpose (see the module header), so they can be pinned with no browser, no
  database and no runner.
*/

function source(over: Partial<PackageSource>): PackageSource {
  return {
    id: "s1",
    title: "Council agenda",
    tier: "B",
    url: "https://example.org/agenda",
    locator: "",
    offlineReference: "",
    ...over,
  };
}

function claim(over: Partial<PackageClaim>): PackageClaim {
  return {
    id: "c1",
    text: "The council voted 5-2.",
    status: "UNVERIFIED",
    sourceIds: [],
    nextCheck: "",
    ...over,
  };
}

function story(over: Partial<PackageStory>): PackageStory {
  return {
    id: "story-1",
    headline: "Budget passes",
    draft: "",
    plainBrief: "",
    cannotSay: "",
    readinessTier: 2,
    claims: [],
    sources: [],
    ...over,
  };
}

function report(over: Partial<ReportingPackage>): ReportingPackage {
  return {
    packageVersion: 1,
    assignment: "the budget meeting",
    action: "report-meeting",
    city: "Longmont",
    runStatus: "COMPLETE",
    runNote: "",
    meetingCoverage: [],
    actions: [],
    coverageComplete: true,
    stories: [],
    held: [],
    score: null,
    readinessTier: 2,
    unknowns: [],
    receipt: {
      methodVersion: "1.0.0",
      methodDir: "/methods/civic-scanner",
      mode: "full-pipeline",
      modelChoice: "sol",
      modelLabel: "Codex Sol 6.1",
      researchToolsAvailable: true,
      elapsedMs: 1000,
    },
    ...over,
  };
}

describe("reporting run status wording", () => {
  it("calls a COMPLETE run the coverage gate, not a promise the copy is ready", () => {
    const state = reportingRunState(report({ runStatus: "COMPLETE" }));
    assert.equal(state.tone, "ok");
    assert.match(state.label, /coverage check passed/i);
    // The label must never read as a bare "ready to publish"...
    assert.doesNotMatch(state.label, /ready to publish/i);
    // ...and the default detail must actively say it is NOT that, not merely
    // avoid the phrase (the sentence "not a promise that this copy is ready to
    // publish" is exactly the honesty this pins).
    assert.match(state.detail, /not a promise .*ready to publish/i);
  });

  it("quotes the run own note for a PARTIAL run instead of calming it", () => {
    const state = reportingRunState(report({ runStatus: "PARTIAL", runNote: "Two pages timed out." }));
    assert.equal(state.tone, "warn");
    assert.equal(state.detail, "Two pages timed out.");
  });

  it("draws a FAILED run as not finished", () => {
    const state = reportingRunState(report({ runStatus: "FAILED" }));
    assert.equal(state.tone, "err");
    assert.match(state.label, /did not finish/i);
  });
});

describe("claim badge honesty", () => {
  it("downgrades VERIFIED to a warning when no Tier A source travels with it", () => {
    const s = story({ sources: [source({ id: "s1", tier: "B" })] });
    const badge = claimBadge(claim({ status: "VERIFIED", sourceIds: ["s1"] }), s);
    assert.equal(badge.tone, "warn");
    assert.match(badge.status, /no Tier A source/i);
  });

  it("shows VERIFIED as verified only with a resolving Tier A source", () => {
    const s = story({ sources: [source({ id: "s1", tier: "A" })] });
    const badge = claimBadge(claim({ status: "VERIFIED", sourceIds: ["s1"] }), s);
    assert.equal(badge.tone, "ok");
  });

  it("does not count a source id that does not resolve in this package", () => {
    const s = story({ sources: [] });
    const badge = claimBadge(claim({ status: "VERIFIED", sourceIds: ["ghost"] }), s);
    assert.equal(badge.tone, "warn");
  });

  it("never upgrades an UNVERIFIED claim", () => {
    const s = story({ sources: [source({ id: "s1", tier: "A" })] });
    const badge = claimBadge(claim({ status: "UNVERIFIED", sourceIds: ["s1"] }), s);
    assert.equal(badge.tone, "warn");
    assert.equal(badge.status, "Not verified");
  });
});

describe("score and readiness wording", () => {
  it("draws a null score as Not scored, never as zero", () => {
    assert.equal(scoreLine(null), "Not scored");
  });

  it("prints a real score out of twenty", () => {
    assert.equal(
      scoreLine({ immediacy: 4, impact: 5, conflict: 3, novelty: 2, total: 14, whyItMatters: "x" }),
      "14/20",
    );
  });

  it("names the readiness tier rather than showing a bare number", () => {
    assert.match(readinessLabel(3), /Tier 3/);
    assert.match(readinessLabel(0), /No readiness tier/);
  });
});

describe("gaps, locators and held rows", () => {
  it("treats an empty ledger as nothing was read", () => {
    const gaps = packageGaps(report({ coverageComplete: false, actions: [] }));
    assert.ok(gaps.some((g) => /No coverage ledger was filed/i.test(g)));
  });

  it("lists unknowns and held rows as gaps", () => {
    const held: PackageHeld = {
      storyId: "story-1",
      headline: "Side deal",
      reason: "One claim is unresolved.",
      nextCheck: "Ask the clerk.",
      unverified: true,
    };
    const gaps = packageGaps(
      report({ coverageComplete: false, unknowns: ["The recording was cut."], held: [held] }),
    );
    assert.ok(gaps.some((g) => /recording was cut/.test(g)));
    assert.ok(gaps.some((g) => /Side deal/.test(g)));
  });

  it("prints a locator with the page or time when one was recorded", () => {
    assert.equal(
      sourceLocator(source({ url: "https://example.org/min", locator: "p. 4, 00:12:30" })),
      "https://example.org/min | p. 4, 00:12:30",
    );
  });

  it("falls back to the offline reference when there is no URL", () => {
    assert.equal(
      sourceLocator(source({ url: "", offlineReference: "Clerk packet, room 3" })),
      "Clerk packet, room 3",
    );
  });

  it("joins the action evidence and disposition for the ledger", () => {
    const action: CoverageAction = {
      actionId: "a1",
      timestamp: "",
      agendaItem: "Item 7",
      motionOrAction: "Approved",
      outcome: "passed",
      vote: "5-2",
      policyStage: "final",
      evidence: "minutes p.3",
      disposition: "reported",
    };
    assert.equal(actionEvidenceLine(action), "minutes p.3 -- reported");
  });

  it("words the method line and says when research was absent", () => {
    const base = report({}).receipt;
    const line = methodLine(report({ receipt: { ...base, researchToolsAvailable: false } }));
    assert.match(line, /no live research tools/i);
  });

  it("reads back the exact model, endpoint, provider and OFF effort for the editor", () => {
    const parsed = parseReportingPackage({
      ...report({}),
      receipt: {
        ...report({}).receipt,
        requestedRuntime: "auto",
        requestedEffort: "none",
        actualRuntime: "local-model",
        modelEffort: "none",
        localModel: { id: "deepseek-v4.1-flash:cloud", baseUrl: "http://127.0.0.1:11434/v1" },
        modelId: "deepseek-v4.1-flash:cloud",
        modelEndpoint: "http://127.0.0.1:11434/v1",
        runtimeProvider: "Ollama",
        modelLabel: "DeepSeek v4.1 Flash",
      },
    });
    assert.ok(parsed);
    const line = methodLine(parsed!);
    assert.match(line, /DeepSeek v4\.1 Flash/);
    assert.match(line, /deepseek-v4\.1-flash:cloud/);
    assert.match(line, /Ollama/);
    assert.match(line, /effort none \(off\)/);
    assert.match(line, /127\.0\.0\.1:11434\/v1/);
  });

  it("hasReportingPackage is true for any parsed report, even an empty one", () => {
    assert.equal(hasReportingPackage(report({})), true);
    assert.equal(hasReportingPackage(null), false);
  });

  it("marks an unresolved held row in heldLine", () => {
    assert.match(
      heldLine({ storyId: "s", headline: "X", reason: "r", nextCheck: "n", unverified: true }),
      /\(unresolved\)/,
    );
  });
});
