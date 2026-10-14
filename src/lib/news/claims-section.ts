/**
 * Where a body's "Claims and sources" section starts and ends.
 *
 * Pure, text-in/text-out, no database: the public render path uses it to leave
 * story prose alone (Release J, THV-2) and a test can call it directly.
 *
 * The shapes a body can be in, all of them live:
 *   - the model-written appendix:  `<body>\n\n---\n\nCLAIMS AND SOURCES\n\n<bullets>`
 *   - an editor's pasted piece:    `<body>\n\n## Claims and sources\n\n<bullets>`
 *   - a bare heading, any case,     `claims and sources` / `Claims and sources:`
 *
 * WHAT A HEADING IS HERE, and why it is not `story-body.tsx`'s rule. The
 * renderer decides per BLOCK, after it has split the body on blank lines, and
 * only for `publicReading`. This has to find the heading inside the raw string
 * so it can slice around it, and it runs before that split. So it recognises a
 * heading the way the body is actually written -- a line that is the section
 * title and nothing else, optionally carrying a `##` marker or a wrapping
 * `**`, optionally followed by a colon -- which is a superset of the two shapes
 * `story-body.tsx` prints. The two never disagree about WHICH line is the
 * heading, only about which of them is doing the asking.
 *
 * A heading is only a heading if the body is not merely USING the phrase: a
 * story that says "the claims and sources section of the record" is prose, and
 * the `^...$` line anchors below are what keep it prose.
 */

/** The section title, alone on its own line. Same words `story-body.tsx` prints. */
const CLAIMS_HEAD = /^[ \t]*(?:#{1,3}[ \t]+)?(?:\*\*[ \t]*)?claims and sources(?:[ \t]*appendix)?[ \t]*(?:\*\*)?[ \t]*:?[ \t]*$/i;

/**
 * The heads that END the section. `draft-audit.ts` treats these as receipts
 * heads in the same table, and for the same reason: a body that carries an
 * editor's fact sheet or an image prompt under its claims is a desk artifact
 * from top to bottom, and none of it is story. The claims section stops at the
 * first one, so an image prompt's own text is never read as a citation list.
 */
const RECEIPTS_END = /^[ \t]*(?:#{1,3}[ \t]+)?(?:\*\*[ \t]*)?(?:editor'?s fact sheet|social media image prompt|image prompt)[ \t]*(?:\*\*)?[ \t]*:?[ \t]*$/i;

/** An ordinary markdown sub-heading inside the section (`## Also at the meeting`). */
const SUBHEAD_END = /^[ \t]*#{1,3}[ \t]+\S/;

export type SectionBounds = { start: number; end: number };

/**
 * The span of the claims section: from the character the heading begins at,
 * through to the character the section ends at (the start of the next heading
 * line, or the end of the body).
 *
 * `null` when the body has no claims heading at all -- a plain news story, or a
 * body whose section was already stripped. Callers that get `null` leave the
 * text entirely alone, which is what makes this safe to run over everything.
 *
 * The returned `start` is the beginning of the HEADING LINE, not of the line
 * after it, so the heading itself is inside the span. The heading can never be
 * rewritten by a caller that only renames citations -- the line-anchored
 * patterns cannot match "Claims and sources" -- and keeping it inside means
 * `slice(0, start) + rewritten + slice(end)` puts the body back together byte
 * for byte outside the section.
 */
export function claimsSectionBounds(body: string): SectionBounds | null {
  const text = String(body ?? "");
  if (!text) return null;
  const lines = text.split("\n");
  let start = -1;
  let end = text.length;
  let at = 0;
  for (const line of lines) {
    const lineStart = text.indexOf(line, at);
    const lineEnd = lineStart + line.length;
    at = lineEnd + 1;
    if (start < 0) {
      if (CLAIMS_HEAD.test(line)) start = lineStart;
      continue;
    }
    /*
      Inside the section, still counting. The blank line that separates the
      heading from its first bullet is not a heading, and neither is the `---`
      an editor's pasted piece may set above its title.
    */
    if (!line.trim()) continue;
    if (RECEIPTS_END.test(line) || SUBHEAD_END.test(line)) {
      end = lineStart;
      break;
    }
  }
  if (start < 0) return null;
  return { start, end };
}
