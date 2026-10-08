// guards: an editor could act on an old package or angle as current evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportingPackageHistory } from "./reporting-package-view.ts";
import { earlierReportingNotes } from "./notes.ts";

test("keeps the latest package current and preserves older notes as earlier", () => {
  const history = reportingPackageHistory({ requestId: 2, headline: "Current budget" }, [{ requestId: 1, headline: "Old airport" }]);
  assert.deepEqual([history.current.headline, history.earlier.map((item) => item.headline), earlierReportingNotes({ importedReport: "Old notes", angle: "Old airport angle" }).map((item) => item.text)], ["Current budget", ["Old airport"], ["Old notes", "Old airport angle"]]);
});
