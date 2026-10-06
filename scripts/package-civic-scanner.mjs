#!/usr/bin/env node
/**
 * Package the civic-scanner reporting METHOD into the app tree.
 *
 * THE PROBLEM. The reporting runner must run the INSTALLED civic-scanner method
 * (SKILL.md + references/ + scripts/), not a remembered summary of it. At
 * development time that method lives in a skill directory on the operator's
 * machine; at build time the app has to carry its OWN copy, so a deployment does
 * not depend on one person's home directory. `resolveCivicMethodDir` already
 * prefers `<cwd>/civic-scanner` -- this script is what puts the method there.
 *
 * WHAT IT COPIES. Only the text the runner actually reads -- SKILL.md, the
 * WHOLE references/ tree, report-schema.json, build-report.js, LICENSE -- plus
 * the scripts the method's verification steps use. SKILL.md links other-modes,
 * the town source profiles, reddit-intake and the source template BY PATH, so the
 * entire references/ directory is copied: a deployment whose operator does not
 * have the skill installed must still carry every file the method's own links
 * name. Binaries and unrelated mode notes stay out.
 *
 * Safe to re-run, and a no-op (with a clear notice) when no method can be found,
 * because a machine without the skill is a real state the build must survive.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "civic-scanner");

/*
  The files that must be present for a method directory to be considered
  complete (`civic-reporting.server.ts`'s CIVIC_METHOD_REQUIRED_FILES). Kept in
  step with that list; the COPY below is broader than this gate on purpose.
*/
const REQUIRED = ["SKILL.md", "references/full-pipeline.md", "references/editorial-controls.md", "references/daily-scan.md"];

/**
 * Text assets copied whole, as a tree. `references/` carries every file the
 * method's own links name (other-modes, the town profiles, reddit-intake, the
 * source template); `scripts/` carries the verification helpers.
 */
const TREES = ["references", "scripts"];

function candidates() {
  const list = [];
  const configured = process.env.TOWNREPORTER_CIVIC_SCANNER_DIR?.trim();
  if (configured) list.push(configured);
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) list.push(join(home, ".agents", "skills", "civic-scanner"));
  return list;
}

function complete(dir) {
  return dir && REQUIRED.every((rel) => existsSync(join(dir, rel)));
}

const source = candidates().find(complete);
if (!source) {
  console.log("[civic-scanner] no complete method found to package - skip (set TOWNREPORTER_CIVIC_SCANNER_DIR to vendor one)");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
let copied = 0;
const files = ["SKILL.md", "report-schema.json", "build-report.js", "LICENSE"];
for (const rel of files) {
  const from = join(source, rel);
  if (!existsSync(from)) continue;
  const to = join(dest, rel);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  copied += 1;
}
for (const tree of TREES) {
  const from = join(source, tree);
  if (!existsSync(from)) continue;
  for (const rel of walk(from, tree)) {
    const to = join(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(source, rel), to);
    copied += 1;
  }
}
console.log(`[civic-scanner] packaged ${copied} file(s) from ${source} into civic-scanner/`);

/** Every file under `dir`, as paths relative to the skill root. */
function walk(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? prefix + "/" + name : name;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
    else out.push(rel);
  }
  return out;
}
