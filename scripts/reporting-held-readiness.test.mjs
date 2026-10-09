// guards: the editor could receive contradictory readiness and Publish instructions with no open facts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { storyReadiness } from "../src/lib/news/story-readiness.ts";
import { readinessDot } from "../src/lib/news/writer-bar.ts";
import { publishBlockers, publishGateNote } from "../src/lib/news/publish-blockers.ts";
import { story, openReporting } from "./reporting-fix-browser.test-helper.mjs";

test("names the held item consistently and clears readiness when no items remain", async (t) => {
  const held = [{ headline: "Airport future charges", reason: "The future charge amount needs checking." }];
  const input = { headline: "Airport policy", body: "Council approved the airport policy.", claims: [], held };
  const readiness = storyReadiness(input);
  const blockers = publishBlockers({ headline: input.headline, body: input.body, dek: "Policy approved", sectionReady: true,
    readiness: readiness.state, readinessReason: readiness.reason, openClaims: 0, unreviewedClaims: 0,
    unreviewedAccepted: false, namedOutlets: [], evidenceStale: false, reviewingEvidence: false, reconcileActive: false, publishing: false });
  const page = await openReporting(t, [story(input.body)], held);
  assert.equal(readiness.state, "not-ready");
  assert.match(readiness.reason, /Airport future charges/);
  assert.equal(readinessDot(true, readiness).tone, "warn");
  assert.match(publishGateNote(blockers), /Airport future charges/);
  assert.match(await page.locator("body").innerText(), /Airport future charges/);
  assert.equal(storyReadiness({ ...input, held: [] }).state, "verified");
});
