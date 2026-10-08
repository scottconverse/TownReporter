export const YOUTUBE_RETRIES_PER_UTC_DAY = 3;

const MEETING_CAPTURE_LOCK = Symbol.for("townreporter:meeting-capture-pass-lock");
type MeetingCaptureLockState = Map<number, Promise<void>>;

export async function withMeetingCapturePassLock<T>(newsroomId: number, work: () => Promise<T>): Promise<T> {
  const globalState = globalThis as typeof globalThis & Record<symbol, MeetingCaptureLockState | undefined>;
  const locks = (globalState[MEETING_CAPTURE_LOCK] ??= new Map());
  const previous = locks.get(newsroomId) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => { release = resolve; });
  locks.set(newsroomId, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (locks.get(newsroomId) === tail) locks.delete(newsroomId);
  }
}

const RETRY_WAITS_MS = [15, 30, 60].map((minutes) => minutes * 60_000);

export type YoutubeCaptureRetryState = {
  retryDay?: string | null;
  retryCount?: number | null;
  retryAt?: string | Date | null;
};

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextUtcDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

export function youtubeCaptureRetryIsDue(state: YoutubeCaptureRetryState, now: Date): boolean {
  const today = utcDay(now);
  const count = state.retryDay === today ? Number(state.retryCount ?? 0) : 0;
  if (count >= YOUTUBE_RETRIES_PER_UTC_DAY) return false;
  if (!state.retryAt) return true;
  const retryAt = state.retryAt instanceof Date ? state.retryAt.getTime() : Date.parse(state.retryAt);
  return !Number.isFinite(retryAt) || retryAt <= now.getTime();
}

export function nextYoutube429Retry(state: YoutubeCaptureRetryState, now: Date): {
  day: string;
  count: number;
  at: Date;
} {
  const day = utcDay(now);
  const previousCount = state.retryDay === day ? Number(state.retryCount ?? 0) : 0;
  const count = Math.min(previousCount + 1, YOUTUBE_RETRIES_PER_UTC_DAY);
  const ordinaryBackoff = new Date(now.getTime() + RETRY_WAITS_MS[count - 1]!);
  const at = count >= YOUTUBE_RETRIES_PER_UTC_DAY
    ? new Date(Math.max(nextUtcDay(now).getTime(), ordinaryBackoff.getTime()))
    : ordinaryBackoff;
  return { day, count, at };
}

export function isYoutubeRateLimit(reason: string): boolean {
  return /\b429\b|too many requests/i.test(reason);
}
