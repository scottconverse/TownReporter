#!/usr/bin/env node
/**
 * The version a report-local-news SKILL.md declares.
 *
 * ONE RULE, TWO CALLERS. `scripts/package-report-local-news.mjs` uses it to
 * decide whether a skill installed on this machine is newer than the copy in
 * the repository, and `src/lib/news/report-local-news.server.ts` records it on
 * every draft so an editor can tell which instructions produced the work. If
 * the two ever disagreed, a draft would be labelled with a version the build
 * never shipped -- so the rule lives here, as plain JavaScript both can load.
 *
 * WHAT COUNTS AS THE VERSION. The skill states it twice: in the header line
 * `REPORT LOCAL NEWS, v3.1.` and in the change notes, one line per release,
 * written `v3.1 changes ...`, `v3 adds ...`. The HIGHEST number found anywhere
 * in the document is the version, so a file that keeps old change notes still
 * reports the newest one it describes.
 */

/**
 * Every version number the document declares, highest last.
 *
 * @param {string} text whole SKILL.md
 * @returns {string[]}
 */
export function skillVersionCandidates(text) {
  /** @type {string[]} */
  const found = [];
  // The header: `REPORT LOCAL NEWS, v3.1.`
  const header = /^REPORT LOCAL NEWS,\s*v(\d+(?:\.\d+)*)/m.exec(text);
  if (header) found.push(header[1]);
  // Change notes: a line that starts `v3.1 changes ...` / `v3 adds ...`.
  for (const line of text.split(/\r?\n/)) {
    const note = /^v(\d+(?:\.\d+)*)\s+(?:changes|adds)\b/.exec(line.trim());
    if (note) found.push(note[1]);
  }
  return found;
}

/**
 * Compare two dotted version strings numerically, part by part.
 * `"3.10"` is greater than `"3.9"`, which string comparison gets wrong.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative when a < b, 0 when equal, positive when a > b
 */
export function compareSkillVersions(a, b) {
  const left = String(a || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The version a skill document declares, or "" when it declares none.
 *
 * @param {string} text whole SKILL.md
 * @returns {string}
 */
export function skillVersion(text) {
  const candidates = skillVersionCandidates(String(text ?? ""));
  if (!candidates.length) return "";
  return candidates.reduce((highest, candidate) =>
    compareSkillVersions(candidate, highest) > 0 ? candidate : highest,
  );
}
