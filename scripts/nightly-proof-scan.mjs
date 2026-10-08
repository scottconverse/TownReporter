export async function dailyScan(page, pool, base, now = Date.now) {
  await page.goto(`${base}/desk/sources`, { waitUntil: "networkidle" });
  const { rows: before } = await pool.query("select coalesce(max(id), 0) as id from scan_runs");
  await page.getByRole("button", { name: /^Run scan now$/ }).click();
  const deadline = now() + 10 * 60_000;
  let id;
  while (now() < deadline) {
    const { rows } = await pool.query(
      `select s.*, j.status as job_status, j.model_choice, j.error as job_error
       from scan_runs s join desk_jobs j on j.kind = 'scan' and j.subject_id = s.id
       where s.id > $1 and ($2::integer is null or s.id = $2)
       order by s.id asc, j.id desc limit 1`, [before[0].id, id ?? null],
    );
    const row = rows[0];
    if (row) {
      id = row.id;
      const policy = typeof row.policy_snapshot === "string"
        ? JSON.parse(row.policy_snapshot) : row.policy_snapshot;
      if (!policy?.daily) throw new Error(`scan ${id} did not use the saved daily policy`);
      if (row.error || row.job_error) throw new Error(row.error || row.job_error);
      if (row.finished_at && row.job_status === "completed") return row;
      if (row.job_status === "failed") throw new Error(`scan job ${id} failed`);
    }
    await page.waitForTimeout(3_000);
  }
  throw new Error(`daily scan ${id ?? "never started"} did not finish within 10 minutes`);
}
