import type { DarkRunRow } from "./dark.ts";
import type { DarkRunUsageSnapshot } from "./dark-run-budget.ts";
export type StoredDarkRunRow = Omit<DarkRunRow, "stopReason" | "usage" | "usageRecorded"> & {
  stop_reason: string | null;
  usage_totals_json: string | null;
  usage_ledger_json: string | null;
};

const EMPTY_DARK_USAGE: DarkRunUsageSnapshot = {
  totals: {
    modelCalls: 0,
    searches: 0,
    documentReads: 0,
    elapsedMs: 0,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  },
  calls: [],
};

export function presentDarkRun(row: StoredDarkRunRow): DarkRunRow {
  let totals = EMPTY_DARK_USAGE.totals;
  let calls = EMPTY_DARK_USAGE.calls;
  let usageRecorded = false;
  try {
    const parsed = JSON.parse(row.usage_totals_json || "{}") as Partial<
      DarkRunUsageSnapshot["totals"]
    >;
    usageRecorded =
      parsed !== null &&
      !Array.isArray(parsed) &&
      ["modelCalls", "searches", "documentReads", "elapsedMs"].every(
        (key) => typeof parsed[key as keyof typeof parsed] === "number",
      );
    totals = { ...EMPTY_DARK_USAGE.totals, ...parsed };
  } catch {
    totals = EMPTY_DARK_USAGE.totals;
  }
  try {
    const parsed = JSON.parse(row.usage_ledger_json || "[]") as unknown;
    calls = Array.isArray(parsed) ? (parsed as DarkRunUsageSnapshot["calls"]) : [];
  } catch {
    calls = [];
  }
  const { stop_reason, usage_totals_json: _totals, usage_ledger_json: _ledger, ...existing } = row;
  return { ...existing, stopReason: stop_reason, usageRecorded, usage: { totals, calls } };
}
