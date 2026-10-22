#!/usr/bin/env node
/**
 * Slice `scripts/audit.py` out of the report-local-news SKILL.md.
 *
 * The skill carries its audit script twice on purpose: as a real file, and as a
 * fenced block inside SKILL.md, so a surface that delivers only the text can
 * rebuild it. The two must stay byte-identical, and the only safe way to keep
 * them identical is to never retype one of them. This module is the one slicer;
 * the packaging script calls it after every copy, and it can also be run by
 * hand:
 *
 *   node scripts/lib/extract-skill-audit.mjs <SKILL.md> <out/audit.py>
 *
 * The markers themselves are not part of the file. Everything between them is
 * taken exactly, including its final newline.
 */
import { readFileSync, writeFileSync } from "node:fs";

const BEGIN = "----- BEGIN audit.py -----";
const END = "----- END audit.py -----";

/**
 * The audit script embedded in a skill document.
 *
 * @param {string} skillText whole SKILL.md
 * @returns {string} the script, markers excluded
 * @throws when either marker is missing or they are out of order
 */
export function extractAuditScript(skillText) {
  const lines = skillText.split(/\r?\n/);
  const begin = lines.findIndex((line) => line.trim() === BEGIN);
  const end = lines.findIndex((line, index) => index > begin && line.trim() === END);
  if (begin === -1 || end === -1) {
    throw new Error("SKILL.md does not carry a complete audit.py block (BEGIN/END markers).");
  }
  // A trailing empty element from a final newline belongs to the marker line,
  // not to the script; the script's own last line is the one before END.
  return lines.slice(begin + 1, end).join("\n") + "\n";
}

const invokedDirectly = process.argv[1]?.endsWith("extract-skill-audit.mjs");
if (invokedDirectly) {
  const [skillPath, outPath] = process.argv.slice(2);
  if (!skillPath || !outPath) {
    console.error("usage: node scripts/lib/extract-skill-audit.mjs <SKILL.md> <out/audit.py>");
    process.exit(2);
  }
  writeFileSync(outPath, extractAuditScript(readFileSync(skillPath, "utf8")), "utf8");
}
