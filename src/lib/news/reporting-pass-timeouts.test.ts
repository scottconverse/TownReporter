// guards: a long meeting loses its story when reporting calls use the default timeout.
import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { ensureProviderSettingsSchema } from "./provider-settings.ts";
import { performReportingWork } from "./civic-reporting-run.server.ts";
import { initialModelRuntimeReceipt } from "./model-runtime-receipt.ts";
import {
  ingestDouble, passChat, seedClaimedJob, seedMeetingFixture, seedScopedLead,
} from "./civic-reporting-fixtures.test-helper.ts";

async function reportingCalls(runtime: "local-model" | "codex-frontier", callMs?: number) {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  await sql`insert into newsrooms(id, name) values (947, 'Reporting timeout test') on conflict do nothing`;
  await ensureProviderSettingsSchema();
  await sql`delete from provider_settings where newsroom_id = 947`;
  if (callMs !== undefined) await sql`insert into provider_settings(newsroom_id, provider_id, call_ms) values (947, ${runtime}, ${callMs})`;
  const leadId = await seedScopedLead(sql, await seedMeetingFixture(sql));
  const pin = initialModelRuntimeReceipt({
    requestedRuntime: runtime, requestedEffort: "none", actualRuntime: runtime, actualEffort: "none",
    localModel: { baseUrl: "http://127.0.0.1:11434/v1", id: "fixture-model" },
  });
  const [request] = await sql<{ id: number }>`insert into reporting_requests
    (user_id, newsroom_id, request_kind, lead_id, action, assignment, seed_urls, model_choice, model_receipt, method_version)
    values ('civic-reporting-runner-test', 947, 'assignment', ${leadId}, 'report-meeting', 'Report every council action', '[]'::jsonb, ${runtime}, ${JSON.stringify(pin)}::jsonb, '2.6.0') returning id`;
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
      probe: (async () => ({ ok: true, label: "Fixture", choice: runtime })) as never,
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
  return (pass: string) => calls.find((value) => value.route === pass)?.timeoutMs;
}

it("gives the meeting writer and warm pass the pinned provider's stored time budget", async () => {
  // guards: a long meeting loses its story when the stored reporting budget is ignored.
  const timeout = await reportingCalls("local-model", 650000);
  for (const pass of ["warm", "writer"]) assert.equal(timeout(pass), 650000);
});

it("keeps warm and writer calls at 45 seconds with a smaller stored override", async () => {
  // guards: a smaller provider budget prematurely ends reporting and loses the editor's story.
  const timeout = await reportingCalls("local-model", 20000);
  for (const pass of ["warm", "writer"]) assert.equal(timeout(pass), 45000, pass);
});

it("gives the Codex meeting writer ten minutes while the warm pass keeps its default budget", async () => {
  // guards: the Codex writer times out before it can file the editor's meeting story.
  const timeout = await reportingCalls("codex-frontier");
  assert.equal(timeout("warm"), 150000);
  assert.ok((timeout("writer") ?? 0) >= 600000);
});
