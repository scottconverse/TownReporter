/**
 * Turning raw readings into the words on the dashboard.
 *
 * Pure, and tested. The collectors that talk to the machine live in
 * `health.server.ts`; everything that decides what a reading *means* lives
 * here, because that is the part that is easy to get subtly wrong and
 * impossible to notice.
 */

export type HealthState = "ok" | "warn" | "down" | "unknown";

export type HealthCheck = {
  id: string;
  label: string;
  state: HealthState;
  /** The reading itself, short enough to sit on one line. */
  value: string;
  /** Why it matters, or what to do. Empty when the reading speaks for itself. */
  note?: string;
};

/** Worst state wins: one thing down makes the whole page say down. */
export function overallState(checks: HealthCheck[]): HealthState {
  const order: HealthState[] = ["down", "warn", "unknown", "ok"];
  for (const s of order) if (checks.some((c) => c.state === s)) return s;
  return "unknown";
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * Human uptime. Deliberately coarse: "3 days" is what an operator wants at a
 * glance, and a live-updating second counter is noise on a page you read once.
 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "4 minutes ago", from an ISO string or a Date. */
export function formatAgo(when: string | Date | null | undefined, now = new Date()): string {
  if (!when) return "never";
  const t = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(t.getTime())) return "unknown";
  const secs = Math.round((now.getTime() - t.getTime()) / 1000);
  if (secs < 0) return "in the future";
  if (secs < 60) return `${secs}s ago`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Disk state.
 *
 * Warns well before it is a problem, because the failure this guards against is
 * not "disk full" — it is Postgres refusing writes and the paper losing a
 * scan's work at 2am with nobody watching.
 */
export function diskState(freeBytes: number): HealthState {
  if (!Number.isFinite(freeBytes) || freeBytes <= 0) return "unknown";
  const gb = freeBytes / 1024 ** 3;
  if (gb < 2) return "down";
  if (gb < 10) return "warn";
  return "ok";
}

/**
 * How to read a watchdog run.
 *
 * A watchdog that has not run in a while is itself a failure, and a silent one:
 * everything looks fine right up until the moment something breaks and nothing
 * repairs it. Its schedule is five minutes, so twenty is already several missed
 * turns.
 */
export function watchdogState(lastRun: string | null, lastResult: number | null): HealthState {
  if (!lastRun) return "unknown";
  const age = Date.now() - new Date(lastRun).getTime();
  if (Number.isNaN(age)) return "unknown";
  if (age > 20 * 60_000) return "down";
  if (lastResult !== 0 && lastResult !== null) return "warn";
  if (age > 12 * 60_000) return "warn";
  return "ok";
}

/**
 * The public site, as a reader sees it.
 *
 * A non-200 is down, not a warning: there is no partial credit on "can people
 * read the paper".
 */
export function publicState(status: number, error: string): HealthState {
  if (error) return "down";
  if (status === 200) return "ok";
  if (status === 0) return "unknown";
  return "down";
}

/**
 * The Database tile's reading.
 *
 * PGLite answers `current_database()` with "postgres" too, so reading the
 * query result alone cannot tell an operator apart from the embedded
 * fallback whose data dies when the server stops. The caller must say which
 * backend is actually active; this only decides the words.
 */
export function databaseValue(
  embedded: boolean,
  name: string | undefined,
  size: string | undefined,
  ms: number,
): string {
  if (embedded) return `embedded (PGLite) — data is lost when the server stops · answered in ${ms}ms`;
  return `${name ?? "?"} · ${size ?? "?"} · answered in ${ms}ms`;
}

/** Queue health. A job stuck running for an hour is not running. */
export function jobsState(running: number, failed: number, oldestRunningMs: number): HealthState {
  if (running > 0 && oldestRunningMs > 60 * 60_000) return "warn";
  if (failed > 0) return "warn";
  return "ok";
}

/**
 * "in 4m", for a time that has not happened yet.
 *
 * Written because reusing `formatAgo` for the watchdog's next run produced
 * "next in the future" — technically true, useless to read.
 */
export function formatIn(when: string | Date | null | undefined, now = new Date()): string {
  if (!when) return "not scheduled";
  const t = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(t.getTime())) return "unknown";
  const secs = Math.round((t.getTime() - now.getTime()) / 1000);
  if (secs <= 0) return "due now";
  if (secs < 60) return `in ${secs}s`;
  const m = Math.round(secs / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}
