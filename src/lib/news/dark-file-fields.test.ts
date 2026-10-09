// guards: a Dark Desk file could lose its explanation and outlive its selected time limit.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { openInvestigationForEditor } from "./dark-open.ts";
import * as runBudget from "./dark-run-budget.ts";

describe("Dark Desk file limits", () => {
  it("keeps the file's explanation and stops a Quick round at its time limit", async () => {
    await applyMigrationsToTestPglite();
    await ensureInvestigateSchema();
    const opened = await openInvestigationForEditor(`dark-file-fields-${Date.now()}`, {
      paste: "A public planning document",
      title: "Who approved the planning change?",
      ordinaryExplanation: "The posted date may be a clerical error.",
      limitKey: "quick",
    });
    const sql = await getSql();
    const [file] = await sql<{ ordinary_explanation: string; limit_key: string; limit_minutes: number; limit_dollars: number | null }>`
      select ordinary_explanation, limit_key, limit_minutes, limit_dollars
      from investigations where id = ${opened.investigationId}
    `;
    assert.equal(file?.ordinary_explanation, "The posted date may be a clerical error.");
    assert.equal(file?.limit_key, "quick");
    assert.equal(file?.limit_minutes, 20);
    assert.equal(file?.limit_dollars, null);
    assert.equal(typeof runBudget.createDarkRunBudgetForFile, "function");
    let now = 1_000;
    const budget = runBudget.createDarkRunBudgetForFile(
      { elapsedMs: 4 * 60 * 60_000, modelCalls: 2, searches: 3, documentReads: 2 },
      { minutes: file.limit_minutes, dollars: file.limit_dollars },
      { now: () => now },
    );
    now += 20 * 60_000;
    assert.equal(budget.consumeSearch(), false);
  });
});
