export const ROUTINE_NOTICE_SOURCE_LIMIT_ENV = "TOWNREPORTER_ROUTINE_SOURCE_LIMIT";

export const DEFAULT_ROUTINE_NOTICE_SOURCE_LIMIT = 150;
export const MAX_ROUTINE_NOTICE_SOURCE_LIMIT = 500;

/**
 * The one routine-edition source ceiling. An absent, malformed, or out-of-range
 * operator setting falls back to the default instead of making the feature
 * unavailable.
 */
export function routineNoticeSourceLimit() {
  const raw =
    typeof process === "undefined" ? undefined : process.env[ROUTINE_NOTICE_SOURCE_LIMIT_ENV]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_ROUTINE_NOTICE_SOURCE_LIMIT;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_ROUTINE_NOTICE_SOURCE_LIMIT
    ? value
    : DEFAULT_ROUTINE_NOTICE_SOURCE_LIMIT;
}
