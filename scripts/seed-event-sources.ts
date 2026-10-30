#!/usr/bin/env node
import {
  EventSourceSeedError,
  seedEventSources,
} from "../src/lib/news/event-source-seed.server.ts";

type Options = { newsroom: number; batch: number | "all"; apply: boolean };

function parseArgs(args: string[]): Options {
  let newsroom = 0;
  let batch: number | "all" = "all";
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--newsroom" || arg === "--batch") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} needs a value.`);
      index += 1;
      if (arg === "--newsroom") newsroom = Number(value);
      else if (value === "all") batch = "all";
      else batch = Number(value);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isSafeInteger(newsroom) || newsroom < 1) {
    throw new Error("Use --newsroom with a positive newsroom id.");
  }
  if (!(batch === "all" || (Number.isSafeInteger(batch) && batch >= 1))) {
    throw new Error("Use --batch with a positive number or all.");
  }
  return { newsroom, batch, apply };
}

function describe(result: Awaited<ReturnType<typeof seedEventSources>>) {
  const changes = result.planned.filter(
    (item) => item.addSource || item.addApproval || item.addLink,
  );
  const sourceRows = result.applied
    ? result.sourceRowsAdded
    : result.planned.filter((item) => item.addSource).length;
  const approvals = result.applied
    ? result.approvalsAdded
    : result.planned.filter((item) => item.addApproval).length;
  const links = result.applied
    ? result.linksAdded
    : result.planned.filter((item) => item.addLink).length;
  console.log(
    `${result.applied ? "Applied" : "Dry run"}: newsroom ${result.newsroomId}, batch ${result.batch}`,
  );
  console.log(`Source rows: ${sourceRows}; approvals: ${approvals}; automation links: ${links}`);
  for (const item of result.notAccepted) {
    console.log(
      `- ${item.name} (${item.town}): not added; the newsroom already has this URL with status ${item.status}`,
    );
  }
  for (const item of changes) {
    const parts = [
      item.addSource ? "source" : "",
      item.addApproval ? "approval" : "",
      item.addLink ? "link" : "",
    ].filter(Boolean);
    console.log(`- ${item.source.name} (${item.source.town}): ${parts.join(", ")}`);
  }
  if (!changes.length) console.log("No changes needed.");
  if (!result.applied) console.log("Nothing was written. Re-run with --apply to save these rows.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required. Nothing was written.");
  }
  const { getSql, withTransaction } = await import("../src/lib/db.ts");
  await getSql();
  const result = await withTransaction((sql) =>
    seedEventSources(sql, {
      newsroomId: options.newsroom,
      batch: options.batch,
      apply: options.apply,
    }),
  );
  describe(result);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof EventSourceSeedError) console.error(`${error.code}: ${message}`);
  else console.error(message);
  process.exitCode = 1;
}
