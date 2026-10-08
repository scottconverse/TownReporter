/** No draft is queued when the preceding scan has not completed successfully. */
export async function afterScan(scan, draft) {
  if (!scan.ok) return { ok: false, skipped: "daily scan did not complete" };
  return draft();
}

export async function waitForDraft(page, pool, leadId, beforeId, now = Date.now) {
  const queuedUntil = now() + 2 * 60_000;
  let id;
  while (true) {
    const { rows } = await pool.query(
      `select * from desk_jobs where kind = 'draft' and subject_id = $1
       and id > $2 and ($3::integer is null or id = $3) order by id asc limit 1`,
      [leadId, beforeId, id ?? null],
    );
    const job = rows[0];
    if (job) id = job.id;
    if (job?.error || job?.status === "failed") throw new Error(job.error || "draft job failed");
    const started = job?.started_at ? new Date(job.started_at).valueOf() : null;
    if (started !== null) {
      if (job.status === "completed") {
        if (new Date(job.finished_at).valueOf() - started > 8 * 60_000)
          throw new Error("draft did not land within 8 minutes of running");
        return job;
      }
      if (now() >= started + 8 * 60_000)
        throw new Error("draft did not land within 8 minutes of running");
    } else if (now() >= queuedUntil) {
      const { rows: blockers } = await pool.query(
        `select id, kind, stage from desk_jobs where status = 'running'
         and lane = $1 order by id`, [job?.lane ?? "desk"],
      );
      const reason = blockers.map(b => `${b.kind} job ${b.id}: ${b.stage}`).join("; ");
      throw new Error(`draft never started: ${reason || job?.stage || "no draft job was created"}`);
    }
    await page.waitForTimeout(3_000);
  }
}
