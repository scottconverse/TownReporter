// guards: a long meeting loses its story when reporting calls use the default timeout.
import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { providerBudget } from "./ai.ts";
import { ensureProviderSettingsSchema } from "./provider-settings.ts";
import { performReportingWork } from "./civic-reporting-run.server.ts";
import { initialModelRuntimeReceipt } from "./model-runtime-receipt.ts";
import {
  ingestDouble, passChat, seedClaimedJob, seedMeetingFixture, seedScopedLead,
} from "./civic-reporting-fixtures.test-helper.ts";

it("gives the meeting writer and warm pass the pinned provider's stored time budget", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  await sql`insert into newsrooms(id, name) values (947, 'Reporting timeout test') on conflict do nothing`;
  await ensureProviderSettingsSchema();
  await sql`insert into provider_settings(newsroom_id, provider_id, call_ms) values (947, 'local-model', 650000)`;
  const leadId = await seedScopedLead(sql, await seedMeetingFixture(sql));
  const pin = initialModelRuntimeReceipt({
    requestedRuntime: "local-model", requestedEffort: "none", actualRuntime: "local-model", actualEffort: "none",
    localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "fixture-model" },
  });
  const [request] = await sql<{ id: number }>`insert into reporting_requests
    (user_id, newsroom_id, request_kind, lead_id, action, assignment, seed_urls, model_choice, model_receipt, method_version)
    values ('civic-reporting-runner-test', 947, 'assignment', ${leadId}, 'report-meeting', 'Report every council action', '[]'::jsonb, 'local-model', ${JSON.stringify(pin)}::jsonb, '2.6.0') returning id`;
  const workspaceRoot = resolve("artifacts/reporting-timeout-test");
  mkdirSync(workspaceRoot, { recursive: true });
  const calls: { route: string; timeoutMs?: number }[] = [];
  let route = "";
  const fake = passChat({
    count: (value) => {
      route = value;
    },
  });
  await performReportingWork(
    await seedClaimedJob(sql, {
      requestId: request!.id,
      researchScope: "supplied",
      resultJson: JSON.stringify(pin),
    }),
    {
      workspaceRoot,
      resolveMethodDir: () => ({
        dir: resolve("civic-scanner"),
        source: "packaged",
        complete: true,
        missing: [],
      }),
      ingest: ingestDouble(),
      probe: (async () => ({ ok: true, label: "Fixture", choice: "local-model" })) as never,
      chat: (async (
        system: string,
        prompt: string,
        _tokens: number,
        opts: { timeoutMs?: number },
      ) => {
        const reply = await fake(system, prompt);
        calls.push({ route, timeoutMs: opts.timeoutMs });
        return reply;
      }) as never,
    },
  );
  const expected = providerBudget("local-model", { "local-model": { callMs: 650000 } }).callMs;
  for (const pass of ["warm", "writer"]) {
    const call = calls.find((value) => value.route === pass);
    assert.ok(call, `${pass} ran`);
    assert.equal(call.timeoutMs, expected, `${pass} uses the stored provider budget`);
  }
});
