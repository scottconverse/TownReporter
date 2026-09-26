#!/usr/bin/env node
/**
 * The last scan, as one JSON object on stdout.
 *
 * Called by the Control page (ops/control/control-server.mjs) as
 *
 *   node scripts/with-app-env.mjs node ops/control/last-scan.cjs
 *
 * so the database URL comes from the app's own environment chain and not from
 * anything this file guesses. It is the only reason the Control page needs the
 * app's dependencies at all, which is why it is a separate script: the server
 * itself stays zero-dependency and still starts on a machine whose paper is
 * down.
 *
 * READ ONLY. One SELECT, no writes, no DDL, no migrations, no connection to
 * anything but the URL it is handed. The page's promise is that it describes
 * the machine without disturbing it, and this is the file where that promise
 * would be easiest to break.
 *
 * FAILS SOFT, and always exits 0. "Could not read the last scan" is a real
 * answer -- the database may be down, which is exactly when this page matters
 * most -- and it must not be mistaken for "the last scan failed". The failure
 * is reported in the object (`ok: false`), never in the exit code, so a caller
 * that only checks the exit code still cannot see it as a scan verdict.
 *
 * CommonJS (`require`), because the repository is ESM and this file is run
 * directly by `node` with no loader; `.cjs` makes that unambiguous.
 */

const OUT = (value) => process.stdout.write(JSON.stringify(value) + "\n");

/** The object the page renders, for the case where nothing could be read. */
function soft(detail) {
  OUT({ ok: false, detail: detail || "Could not read the last scan" });
  process.exit(0);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) soft("Could not read the last scan (no database URL is configured)");

  let pg;
  try {
    // The one `require` in the repository, and the reason this file is `.cjs`:
    // it is run by plain `node` with no loader, and it must resolve the app's
    // own `pg` from the app's own node_modules. The name is a literal.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pg = require("pg");
  } catch {
    soft("Could not read the last scan (the app's database driver is not installed)");
  }

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch {
    soft("Could not read the last scan (the database did not answer)");
  }

  try {
    // One row: the newest scan. `scan_runs` is ordered by id, not by
    // started_at, because two runs can share a timestamp and the id is the
    // only column that is actually the run's identity.
    const scan = await client.query(
      `select id, started_at, finished_at, sources_fetched, leads_created,
              sources_analyzed, model_batches_failed, summary, error,
              execution_origin, model_snapshot
         from scan_runs
        order by id desc
        limit 1`,
    );
    if (!scan.rows.length) soft("No scan has run yet");

    const row = scan.rows[0];

    // The model the run actually used. `model_snapshot` is the round's pin;
    // the job row is what the desk recorded as the concrete choice for THIS
    // subject, and is the better answer when it exists. Both are optional --
    // this is a description, never a verdict about the run.
    let model = null;
    try {
      const job = await client.query(
        `select model_choice, model_choice_source
           from desk_jobs
          where kind = 'scan' and subject_id = $1
          order by id desc
          limit 1`,
        [row.id],
      );
      if (job.rows.length && job.rows[0].model_choice) {
        const source = job.rows[0].model_choice_source;
        model = source ? `${job.rows[0].model_choice} (${source})` : job.rows[0].model_choice;
      }
    } catch {
      /* an unwritten model is not a failure of the scan */
    }
    if (!model && row.model_snapshot) {
      try {
        const snap = JSON.parse(row.model_snapshot);
        model = snap?.modelId || snap?.model || snap?.choice || (typeof snap === "string" ? snap : null);
      } catch {
        model = String(row.model_snapshot).slice(0, 60);
      }
    }

    // A run that has an error AND no finish never completed; a run with an
    // error and a finish completed badly. Saying "failed" for both would hide
    // the difference between a run that died mid-way and one that reported and
    // stopped, so the wording carries it.
    let status;
    if (row.error && !row.finished_at) status = "failed (never finished)";
    else if (row.error) status = "failed";
    else if (!row.finished_at) status = "running";
    else status = "finished";

    OUT({
      ok: true,
      id: row.id,
      startedAt: row.started_at ? new Date(row.started_at).toISOString().replace("T", " ").slice(0, 16) : null,
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString().replace("T", " ").slice(0, 16) : null,
      status,
      leads: row.leads_created,
      sourcesFetched: row.sources_fetched,
      sourcesAnalyzed: row.sources_analyzed,
      batchesFailed: row.model_batches_failed,
      origin: row.execution_origin || null,
      model,
      summary: row.summary ? String(row.summary).slice(0, 200) : null,
    });
    process.exit(0);
  } catch (error) {
    soft("Could not read the last scan (" + String((error && error.message) || error).slice(0, 120) + ")");
  } finally {
    try {
      await client.end();
    } catch {
      /* the process is about to exit */
    }
  }
}

main().catch(() => soft());
