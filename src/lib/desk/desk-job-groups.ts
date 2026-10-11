export type DeskJobGroupRow = {
  id?: number;
  status: string;
  queuePosition?: number | null;
  queueLength?: number | null;
};

/** Split the live queue into disjoint running and waiting lists. */
export function splitDeskJobs<T extends DeskJobGroupRow>(rows: readonly T[]) {
  const queued = rows.filter((row) => row.status === "queued").sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  return {
    running: rows.filter((row) => row.status === "running"),
    queued: queued.map((row, index) => ({
      ...row,
      queuePosition: row.queuePosition ?? index + 1,
      queueLength: row.queueLength ?? queued.length,
    })),
  };
}
