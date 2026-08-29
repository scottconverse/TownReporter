/**
 * Turning a desk item into an editorial, and an editorial back into a draft.
 *
 * The voice file is the author. This module is the desk clerk: it hands over
 * the right raw material in the shape the voice asked for, and files what comes
 * back. It contains no writing instructions of its own beyond the two the
 * newsroom must add — and it never edits the voice file, which is treated as
 * read-only by contract.
 */

/** Everything an editorial can be built from. */
export type EditorialSource =
  | { kind: "article"; slug: string }
  | { kind: "lead"; id: number }
  | { kind: "investigation"; id: number }
  | { kind: "paste"; text: string };

export type EditorialPointer = {
  what: string;
  url?: string;
};

/**
 * The five parts the voice returns, in its stated order.
 *
 * Delivery hygiene in the voice file says the output begins with the headline
 * and ends with the last field of the image prompt, nothing before or after. So
 * anything outside those five parts is a parsing failure, not a bonus.
 */
export type Editorial = {
  headline: string;
  body: string;
  appendix: string;
  factSheet: string;
  imagePrompt: string;
};

const HEAD = {
  appendix: /^\s*(CLAIMS AND SOURCES(?: APPENDIX)?)\s*$/im,
  factSheet: /^\s*(EDITOR'?S FACT SHEET)\s*$/im,
  image: /^\s*(SOCIAL MEDIA IMAGE PROMPT|IMAGE PROMPT)\s*$/im,
};

function cut(text: string, re: RegExp): [string, string] {
  const m = re.exec(text);
  if (!m) return [text, ""];
  return [text.slice(0, m.index), text.slice(m.index + m[0].length)];
}

/**
 * Split the delivered piece into its parts.
 *
 * Tolerant on purpose. A missing appendix is a real outcome the voice file
 * describes — "omit the section entirely" when it had no web tools — so a piece
 * with only a headline and a body is valid, not broken. What is never
 * acceptable is silently losing the body.
 */
export function parseEditorial(raw: string): Editorial {
  const text = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return { headline: "", body: "", appendix: "", factSheet: "", imagePrompt: "" };

  const [beforeImage, imagePrompt] = cut(text, HEAD.image);
  const [beforeFact, factSheet] = cut(beforeImage, HEAD.factSheet);
  const [beforeAppendix, appendix] = cut(beforeFact, HEAD.appendix);

  const lines = beforeAppendix.trim().split("\n");
  // The first non-empty line is the headline; markdown hashes are stripped
  // because the voice file bans markup in the delivered piece.
  let headline = "";
  let i = 0;
  for (; i < lines.length; i++) {
    const t = lines[i]!.replace(/^#+\s*/, "").trim();
    if (t) {
      headline = t;
      i++;
      break;
    }
  }
  return {
    headline,
    body: lines.slice(i).join("\n").trim(),
    appendix: appendix.trim(),
    factSheet: factSheet.trim(),
    imagePrompt: imagePrompt.trim(),
  };
}

/**
 * OPINION, once, at the front.
 *
 * The operator's rule: it cannot be mistaken for anything else, and there is no
 * byline because an unsigned editorial is the paper's own position — the
 * century-old convention, and the honest one for a paper run by one person.
 */
export function opinionHeadline(headline: string): string {
  const clean = String(headline ?? "").replace(/^\s*OPINION\s*[:—-]\s*/i, "").trim();
  return clean ? `OPINION: ${clean}` : "OPINION";
}

/**
 * The two things the newsroom must tell the voice, and nothing else.
 *
 * The voice file is not edited — the operator built it over months and says
 * small changes break it — so per-call instructions live here, in the material
 * handed over, where they belong.
 *
 * Both exist because this newsroom is a specific case the file could not know:
 * its own reporting is a citable source, and its own machine output is not.
 */
export const NEWSROOM_NOTE = `NOTES FROM THE DESK, for this piece only.

This piece runs in TownReporter, the Longmont paper whose stories are cited below. TownReporter's own published reporting IS a citable source in the claims appendix — link it like any other outlet, and still go to the primary document underneath it. Everything else in the voice file stands unchanged.

The desk material below is a LEAD in the sense your machine-assisted leads rule means. It is pointers, not findings. Nothing in it has been verified for this piece. Take the document pointers, open the originals yourself, and delete anything you cannot stand behind.

The piece runs unsigned, as the paper's own editorial position. Write no byline and no first-person reference to the paper's staff.`;

/**
 * The raw material, as pointers.
 *
 * Deliberately thin. The temptation is to hand over the desk's conclusions,
 * which would make the editorial a rewrite of a machine's opinion — the exact
 * thing the voice file's machine-assisted leads rule refuses.
 */
export function buildEditorialPack(input: {
  subject: string;
  pointers: EditorialPointer[];
  ourStory?: { headline: string; url: string; dek?: string };
  askedFor?: string;
}): string {
  const parts: string[] = [NEWSROOM_NOTE, "", `SUBJECT: ${input.subject}`];

  if (input.ourStory) {
    parts.push(
      "",
      "TOWNREPORTER'S OWN REPORTING ON THIS (citable, and worth going underneath):",
      `${input.ourStory.headline}${input.ourStory.dek ? ` — ${input.ourStory.dek}` : ""}`,
      input.ourStory.url,
    );
  }

  const pointers = input.pointers.filter((p) => p.what.trim());
  parts.push(
    "",
    "DOCUMENT POINTERS FROM THE DESK (unverified leads, open them yourself):",
    pointers.length
      ? pointers.map((p) => `- ${p.what}${p.url ? `\n  ${p.url}` : ""}`).join("\n")
      : "(none — start from the subject line)",
  );

  if (input.askedFor?.trim()) {
    parts.push("", `WHAT THE EDITOR ASKED FOR: ${input.askedFor.trim()}`);
  }

  parts.push("", "Write the piece.");
  return parts.join("\n");
}

/** The tools the voice needs. Its receipts posture collapses without them. */
export const EDITORIAL_TOOLS = ["WebSearch", "WebFetch"];
