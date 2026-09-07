/** Search preferences guide queries; they are never evidence of a document's date. */
export type ResearchPreferences = {
  mode: "lookback" | "range";
  lookbackDays: number;
  startDate: string | null;
  endDate: string | null;
  verificationLimit: number;
};
export type ResearchSnapshot = ResearchPreferences & {
  startDate: string;
  endDate: string;
  capturedAt: string;
};
export const DEFAULT_RESEARCH_PREFERENCES: ResearchPreferences = {
  mode: "lookback",
  lookbackDays: 90,
  startDate: null,
  endDate: null,
  verificationLimit: 6,
};
function dateValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Use a complete calendar date (YYYY-MM-DD).");
  const parsed = new Date(value + "T00:00:00Z");
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    value < "1900-01-01" ||
    value > "2099-12-31"
  )
    throw new Error("Use a real calendar date from 1900 through 2099.");
  return value;
}
export function validateResearchPreferences(raw: unknown): ResearchPreferences {
  if (raw === undefined) return { ...DEFAULT_RESEARCH_PREFERENCES };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid investigative preferences.");
  const r = raw as Partial<ResearchPreferences>;
  const mode = r.mode === undefined ? "lookback" : r.mode;
  if (!["lookback", "range"].includes(mode)) throw new Error("Choose a lookback or a date range.");
  const lookbackDays = r.lookbackDays === undefined ? 90 : r.lookbackDays,
    verificationLimit = r.verificationLimit === undefined ? 6 : r.verificationLimit;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 3650)
    throw new Error("Lookback must be 1–3650 days.");
  if (!Number.isInteger(verificationLimit) || verificationLimit < 1 || verificationLimit > 24)
    throw new Error("Verification limit must be 1–24 signals per round.");
  const startDate = dateValue(r.startDate),
    endDate = dateValue(r.endDate);
  if (mode === "range" && (!startDate || !endDate || startDate > endDate))
    throw new Error("Give both dates, with the start on or before the end.");
  return { mode, lookbackDays, startDate, endDate, verificationLimit };
}
const shifted = (date: string, days: number) =>
  new Date(new Date(date + "T00:00:00Z").getTime() + days * 86400000).toISOString().slice(0, 10);
export function resolveResearchPreferences(raw: unknown, now = new Date()): ResearchSnapshot {
  const p = validateResearchPreferences(raw),
    today = now.toISOString().slice(0, 10);
  return {
    ...p,
    startDate: p.mode === "range" ? p.startDate! : shifted(today, 1 - p.lookbackDays),
    endDate: p.mode === "range" ? p.endDate! : today,
    capturedAt: now.toISOString(),
  };
}
export function queryWithResearchWindow(query: string, snapshot?: ResearchSnapshot): string {
  if (!snapshot) return query;
  const clean = query
    .replace(/\b(?:after|before):\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return `${clean} after:${shifted(snapshot.startDate, -1)} before:${shifted(snapshot.endDate, 1)}`;
}
export function describeResearchWindow(snapshot: ResearchSnapshot): string {
  return `Search date preference: ${snapshot.startDate} through ${snapshot.endDate} (inclusive). Date operators are search hints, not proof of source dates or completeness. Check dates in the captured record. Verification limit: ${snapshot.verificationLimit} signals this round; all four gates still apply.`;
}
