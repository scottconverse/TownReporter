/*
  Where the report-local-news skill lives on this machine, and which version of
  it a draft was written under -- SERVER ONLY (`.server.ts`).

  WHY THIS FILE EXISTS AT ALL. The meeting writer no longer holds its own
  instructions in code: it runs Scott's report-local-news skill AS IS (D200),
  with SKILL.md in the run's own folder as the agent's only rule set. That makes
  the skill an ARTEFACT the app has to locate, exactly the way `civic-scanner`
  is located by `resolveCivicMethodDir` (civic-reporting.server.ts) -- a packaged
  copy beside the app, or an operator-configured directory, never a hardcoded
  personal path as the only mechanism.

  The version rule is shared with `scripts/package-report-local-news.mjs`
  through `scripts/lib/skill-version.mjs`: the build decides what to copy with
  it, and a run records what it read with it. Two copies of that rule would
  eventually label a draft with a version the build never shipped.
*/
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { skillVersion } from "../../../scripts/lib/skill-version.mjs";

/** The files a valid report-local-news skill directory must contain. */
export const REPORT_LOCAL_NEWS_REQUIRED_FILES = ["SKILL.md", "scripts/audit.py"] as const;

export type ReportLocalNewsDir = {
  /** The directory a run should read its instructions from. */
  dir: string;
  /** True when the directory holds the files the skill needs. */
  complete: boolean;
  /** Which of the required files are missing (empty when complete). */
  missing: string[];
  /** How the directory was chosen: "configured" | "packaged" | "none". */
  source: "configured" | "packaged" | "none";
};

/**
 * Where the report-local-news skill lives, in priority order.
 *
 *   1. An operator-configured directory (`TOWNREPORTER_REPORT_LOCAL_NEWS_DIR`),
 *      so a deployment can vendor or pin a specific copy without a code change.
 *   2. The directory packaged beside the app (`<cwd>/report-local-news`), put
 *      there at build time by `scripts/package-report-local-news.mjs`.
 *
 * Unlike the civic method there is deliberately no "known install" fallback:
 * the skill is small enough to ship, and a run that silently reads a folder in
 * somebody's home is a run nobody can reproduce.
 *
 * Returns the first candidate that EXISTS; `complete` says whether it holds the
 * files the skill needs. A caller that needs a live skill refuses when none is
 * complete rather than running an agent without its instructions.
 */
export function resolveReportLocalNewsDir(
  env: Record<string, string | undefined> = process.env,
): ReportLocalNewsDir {
  const candidates: { dir: string; source: ReportLocalNewsDir["source"] }[] = [];
  const configured = env.TOWNREPORTER_REPORT_LOCAL_NEWS_DIR?.trim();
  if (configured) candidates.push({ dir: configured, source: "configured" });
  candidates.push({ dir: join(process.cwd(), "report-local-news"), source: "packaged" });
  for (const candidate of candidates) {
    if (!existsSync(candidate.dir)) continue;
    const missing = REPORT_LOCAL_NEWS_REQUIRED_FILES.filter((file) => !existsSync(join(candidate.dir, file)));
    return { dir: candidate.dir, source: candidate.source, complete: missing.length === 0, missing };
  }
  return { dir: "", source: "none", complete: false, missing: [...REPORT_LOCAL_NEWS_REQUIRED_FILES] };
}

/**
 * The version a SKILL.md declares (`v3.1` -> `"3.1"`), or `""` when it declares
 * none. Recorded on every draft so an editor can tell which instructions
 * produced the work.
 */
export function reportLocalNewsVersion(skillText: string): string {
  return skillVersion(skillText);
}

/** Read the skill's own version off disk, or `""` when the file is unreadable. */
export function readReportLocalNewsVersion(dir: string): string {
  if (!dir) return "";
  try {
    return reportLocalNewsVersion(readFileSync(join(dir, "SKILL.md"), "utf8"));
  } catch {
    return "";
  }
}
