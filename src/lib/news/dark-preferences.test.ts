import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateResearchPreferences,
  resolveResearchPreferences,
  queryWithResearchWindow,
} from "./dark-preferences.ts";
test("defaults resolve a 90-day preference and six verification attempts", () => {
  const p = resolveResearchPreferences(undefined, new Date("2026-09-07T12:00:00Z"));
  assert.equal(p.verificationLimit, 6);
  assert.equal(p.startDate, "2026-06-10");
  assert.equal(p.endDate, "2026-09-07");
  assert.match(queryWithResearchWindow("school choir", p), /after:2026-06-09 before:2026-09-08/);
});
test("validates bounds and real calendar ranges without changing unrelated settings", () => {
  for (const raw of [
    { lookbackDays: 0 },
    { lookbackDays: 3651 },
    { verificationLimit: 25 },
    { verificationLimit: 0 },
    { mode: "range", startDate: "2026-02-30", endDate: "2026-03-01" },
    { mode: "range", startDate: "2026-09-08", endDate: "2026-09-07" },
  ])
    assert.throws(() => validateResearchPreferences(raw));
  const valid = validateResearchPreferences({
    mode: "range",
    startDate: "2024-02-29",
    endDate: "2024-03-01",
    verificationLimit: 24,
  });
  assert.equal(valid.startDate, "2024-02-29");
  assert.equal(valid.verificationLimit, 24);
});

test('explicit null or malformed stored fields never become default preferences',()=>{for(const value of [null,{mode:null},{verificationLimit:null},{lookbackDays:null}])assert.throws(()=>validateResearchPreferences(value));});

test("lookback counts exactly the selected number of inclusive calendar dates", () => {
  const today = new Date("2024-03-01T12:00:00Z");
  const one = resolveResearchPreferences({ lookbackDays: 1 }, today);
  assert.equal(one.startDate, "2024-03-01");
  assert.equal(one.endDate, "2024-03-01");
  const two = resolveResearchPreferences({ lookbackDays: 2 }, today);
  assert.equal(two.startDate, "2024-02-29");
});
