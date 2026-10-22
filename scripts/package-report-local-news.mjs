#!/usr/bin/env node
/**
 * Package the report-local-news reporting SKILL into the app tree.
 *
 * THE PROBLEM. The meeting writer runs Scott's report-local-news skill AS IS:
 * the agent's only instructions are the SKILL.md in its own folder. At
 * development time that skill lives in a skill directory on the operator's
 * machine; at build time the app has to carry its OWN copy, so a deployment
 * does not depend on one person's home directory. `resolveReportLocalNewsDir`
 * already prefers `<cwd>/report-local-news` -- this script is what puts the
 * skill there, the same way `package-civic-scanner.mjs` does for civic-scanner.
 *
 * WHAT IT COPIES. SKILL.md and scripts/audit.py. That is the whole skill: the
 * agent reads SKILL.md, and the audit script it is told to run has to be beside
 * it. audit.py is always re-extracted from the SKILL.md block that carries it,
 * never taken from the candidate's own scripts/ folder -- the embedded copy is
 * the canonical one, and slicing it again keeps the two byte-identical.
 *
 * THE VERSION GUARD. A machine can hold an older installed copy (today the
 * synced skill is v3 while the repository is v3.1). Copying it over the
 * repository would silently downgrade the writer, so the candidate is copied
 * ONLY when its version is strictly higher than the committed one. Otherwise
 * this prints one line and exits 0 -- a skill on the machine being older is a
 * normal state, not a build failure.
 *
 * Safe to re-run, and a no-op (with a clear notice) when no skill can be found,
 * because a machine without the skill is a real state the build must survive.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractAuditScript } from "./lib/extract-skill-audit.mjs";
import { compareSkillVersions, skillVersion } from "./lib/skill-version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "report-local-news");

/**
 * Where a complete installed copy of the skill may live, in priority order:
 * an operator-configured directory, then each synced skill folder, then the
 * agents skills folder.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function defaultCandidates(env = process.env) {
  /** @type {string[]} */
  const list = [];
  const configured = env.TOWNREPORTER_REPORT_LOCAL_NEWS_DIR?.trim();
  if (configured) list.push(configured);
  const home = env.USERPROFILE ?? env.HOME;
  if (home) {
    // The synced skills folder holds one directory per skill. Only its DIRECT
    // children are listed -- one skill's tree is never walked looking for
    // another skill.
    const synced = join(home, ".claude", "skills", "synced");
    if (existsSync(synced)) {
      for (const name of readdirSync(synced)) {
        const dir = join(synced, name, "report-local-news");
        if (existsSync(dir) && statSync(dir).isDirectory() && !list.includes(dir)) list.push(dir);
      }
    }
    list.push(join(home, ".agents", "skills", "report-local-news"));
  }
  return list;
}

/**
 * Copy an installed skill over the committed folder, when it is newer.
 *
 * Exported with its inputs as parameters so a test can point it at two temp
 * folders and see the decision, without touching the repository's own copy.
 *
 * @param {{ destDir: string, candidates: (string | undefined)[] }} input
 * @returns {{ copied: boolean, version: string, source?: string, reason: string }}
 */
export function packageReportLocalNews({ destDir, candidates }) {
  const source = candidates.find((dir) => dir && existsSync(join(dir, "SKILL.md")));
  if (!source) {
    return { copied: false, version: "", reason: "no installed skill found to package" };
  }
  const incomingVersion = skillVersion(readFileSync(join(source, "SKILL.md"), "utf8"));
  const committedFile = join(destDir, "SKILL.md");
  const committedVersion = existsSync(committedFile) ? skillVersion(readFileSync(committedFile, "utf8")) : "";
  if (committedVersion && compareSkillVersions(incomingVersion, committedVersion) <= 0) {
    return {
      copied: false,
      version: incomingVersion,
      source,
      reason: `installed skill is v${incomingVersion || "?"}, the committed copy is v${committedVersion} - keeping the committed copy`,
    };
  }
  mkdirSync(join(destDir, "scripts"), { recursive: true });
  cpSync(join(source, "SKILL.md"), committedFile);
  // Sliced out of the SKILL.md just written, so the pair can never drift even
  // if the candidate's own scripts/ folder holds a different build.
  writeFileSync(join(destDir, "scripts", "audit.py"), extractAuditScript(readFileSync(committedFile, "utf8")), "utf8");
  return {
    copied: true,
    version: incomingVersion,
    source,
    reason: `packaged v${incomingVersion || "?"} from ${source} into report-local-news/`,
  };
}

const invokedDirectly = process.argv[1]?.endsWith("package-report-local-news.mjs");
if (invokedDirectly) {
  const result = packageReportLocalNews({ destDir: dest, candidates: defaultCandidates() });
  console.log(`[report-local-news] ${result.reason}`);
}
