// guards: a follow-up could disappear from the case that asked the AI to watch it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { openInvestigationForEditor } from "./dark-open.ts";
import { performCreateAiFollowUp, performListFollowUps } from "./follow-ups.ts";

describe("file-linked AI follow-ups", () => {
  it("keeps its investigation and file name on the Follow-ups list", async () => {
    await applyMigrationsToTestPglite();
    const context = { userId: `follow-up-file-${Date.now()}`, newsroomId: 731 };
    const file = await openInvestigationForEditor(context.userId, { paste: "A city notice", title: "The missing notice" }, context.newsroomId);
    const created = await performCreateAiFollowUp(context, {
      what: "Watch for the next public notice",
      agentKind: "recheck",
      schedule: "daily",
      targets: ["https://example.test/notices"],
      investigationId: file.investigationId,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const row = (await performListFollowUps(context)).find((item) => item.id === created.id);
    assert.equal(row?.investigation_id, file.investigationId);
    assert.equal(row?.investigation_title, file.title);
  });
});
