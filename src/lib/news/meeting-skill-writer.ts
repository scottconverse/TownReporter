/*
  The council-meeting writer's PURE half -- client-safe, no `node:` imports, no
  database, no model.

  WHAT THIS WRITER IS. Not the app's own prose generator: the report-local-news
  skill (Scott, D200) run as-is by an agent in its own folder, with the whole
  transcript typed out as a file the agent reads start to end. This module holds
  the three things that can be decided without a disk or a database -- the shape
  of the transcript handed over, the assignment text, and how the agent's answer
  is split into a story and an editor file -- so each of them can be tested
  against the real proof run's output.
*/

export type MeetingTranscriptLine = { startSeconds: number; excerpt: string };

/**
 * `5:36:07` -- hours unpadded, minutes and seconds two digits.
 *
 * The transcript the agent reads carries a stamp on every line, and the skill's
 * citations quote those stamps. A stamp that loses its hour, or that pads the
 * hour to `05`, stops matching what a reader hears on the video.
 */
export function meetingStamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * The transcript file the agent reads.
 *
 * One header line naming what it is, then one line per caption:
 *
 *   Longmont City Council Regular Session - October 20, 2026. YouTube rsagM9xn28Y. Full captions, 7958 lines, 0:00:19 to 5:36:07.
 *
 *   0:00:19  Thank you.
 *
 * The header is the one thing the skill's own rules tell the agent to trust
 * about scope, so the line count and the first and last stamps are computed
 * from the segments themselves and never guessed.
 */
export function formatTranscript(
  title: string,
  date: string,
  videoId: string,
  segments: readonly MeetingTranscriptLine[],
): string {
  const lines = segments.map((segment) => `${meetingStamp(segment.startSeconds)}  ${segment.excerpt.trim()}`);
  const first = lines.length ? meetingStamp(segments[0]!.startSeconds) : "0:00:00";
  const last = lines.length ? meetingStamp(segments[segments.length - 1]!.startSeconds) : "0:00:00";
  // The meeting's own title usually carries its date ("... Regular Session -
  // October 20, 2026"). Add it only when it is not already there, so the header
  // reads the way the record reads and never says the date twice.
  const named = title.trim();
  const dated = !date.trim() || named.includes(date.trim()) ? named : `${named} - ${date.trim()}`;
  return [`${dated}. YouTube ${videoId}. Full captions, ${lines.length} lines, ${first} to ${last}.`, "", ...lines, ""].join("\n");
}

/**
 * The assignment handed to the agent.
 *
 * Deliberately says nothing about this app, its models, or the person who
 * scheduled the run: the skill is the only rule set, and the folder is the only
 * place the agent may work. Everything a run needs to be reproducible (which
 * meeting, which video, how long the transcript is) is stated; everything else
 * the skill already says.
 */
export function assignmentPrompt(input: {
  title: string;
  date: string;
  videoId: string;
  lineCount: number;
  firstStamp: string;
  lastStamp: string;
  /** Today's date, as the editor's desk would say it (e.g. "Wednesday, Oct. 21, 2026"). */
  today: string;
}): string {
  return [
    `Your instructions are the file SKILL.md in your working folder. Read ALL of it first, every line, then follow it exactly. It is the only rule set for this job. Today is ${input.today} (America/Denver).`,
    "",
    "## The assignment (what the editor's desk hands you)",
    `- Cover the whole meeting, comprehensively: ${input.title}, ${input.date}. Meeting mode.`,
    `- Full caption transcript, one line per caption with its time stamp: transcript.txt in your working folder (YouTube video ${input.videoId}, ${input.lineCount.toLocaleString("en-US")} lines, ${input.firstStamp} to ${input.lastStamp}). Read all of it, start to end.`,
    "- The audit script is at scripts/audit.py. Run it with: python scripts/audit.py draft.txt --meeting",
    "- Get the agenda, packet and minutes yourself from the public records the skill names (the city's public portal, the city website). Use curl and pdftotext in the shell; web tools may not work here.",
    "",
    "## Output",
    "- Write the full deliverable (both blocks, exactly as the skill lays them out) to story.txt in your working folder. Keep draft.txt for the script runs.",
    "- Write the script's final run output to audit-final.txt.",
    "- Write CHECK-FIRST.txt: AT MOST 3 lines, the items an editor must check before publishing that would do the most harm if wrong, most harmful first: a sentence with legal risk, then the lead's central fact or number, then a vote or a quote that rests only on captions. Everything else you flagged stays in the EDITOR FILE, not here. Plain sentences, one per line. No bullets, no numbering. If nothing rises to that level, write an empty file.",
    "- Write RUN-NOTES.md: which records you opened (URLs), what you could not get and why, the final script result line, and your ranking record line. Last line: RUN-DONE.",
    "",
    "## Limits",
    "- Work only inside your working folder. Do not search the disk (no find, rg, grep -r or dir /s over other folders).",
    "- Never open or print environment.private.json, any .env file, any file with .private in its name, session.json or auth.json.",
    "- No outreach: send no email or message to anyone. No posting anywhere.",
    "- No questions: nobody can answer. If something is unclear, choose the reading the skill supports, note it in the EDITOR FILE, and keep going.",
    "",
  ].join("\n");
}

/** Everything before the marker is publishable; the marker and after are not. */
export const EDITOR_FILE_MARKER = "EDITOR FILE: NOT FOR PUBLICATION";

export type SkillStory = {
  ok: true;
  /** The story's first non-empty line. */
  headline: string;
  /** The standfirst under it. */
  dek: string;
  /** Everything else in the publish block, including the roundup and the claims. */
  body: string;
  /** The marker line and everything after it: never published. */
  editorFile: string;
};

export type SkillStoryFailure = {
  ok: false;
  reason: "missing-marker" | "empty-headline" | "empty-body";
  /** A plain sentence for the editor. */
  error: string;
};

/**
 * Split the agent's `story.txt` into the part a reader sees and the part only
 * an editor sees.
 *
 * The skill lays the deliverable out in two blocks separated by a line reading
 * `EDITOR FILE: NOT FOR PUBLICATION`. The publish block is the headline, the
 * dek, and the body -- which itself keeps `ALSO AT THE MEETING` and `CLAIMS AND
 * SOURCES`, because both are part of what the editor publishes. Everything from
 * the marker on is the editor's file: claim checks, the fact sheet, the ledger.
 *
 * A missing marker is a refusal rather than a guess: publishing the editor file
 * would put the meeting ledger and the legal notes on the paper.
 */
export function parseSkillStory(text: string): SkillStory | SkillStoryFailure {
  const lines = String(text ?? "").split(/\r?\n/);
  const marker = lines.findIndex((line) => line.trim() === EDITOR_FILE_MARKER);
  if (marker === -1) {
    return {
      ok: false,
      reason: "missing-marker",
      error: `The writer did not separate the story from the editor file (no "${EDITOR_FILE_MARKER}" line).`,
    };
  }
  const publish = lines.slice(0, marker);
  const nonEmpty = publish.map((line, index) => ({ line: line.trim(), index })).filter((entry) => entry.line);
  if (!nonEmpty.length) {
    return { ok: false, reason: "empty-headline", error: "The writer produced no headline." };
  }
  const headline = nonEmpty[0]!.line;
  const dek = nonEmpty[1]?.line ?? "";
  // The body starts after the dek's own line, so its original blank lines and
  // paragraph breaks survive.
  const bodyStart = nonEmpty[1]?.index ?? nonEmpty[0]!.index;
  const body = publish.slice(bodyStart + 1).join("\n").trim();
  if (!body) {
    return { ok: false, reason: "empty-body", error: "The writer produced a headline but no story." };
  }
  return {
    ok: true,
    headline,
    dek,
    body,
    editorFile: lines.slice(marker).join("\n").trim(),
  };
}

/**
 * The https sources the draft's own CLAIMS AND SOURCES block names.
 *
 * The block is part of the published story, and every claim under it carries
 * its source as a link. Those links are the draft's `source_urls`: what the
 * desk checks before publishing and what the reader can follow afterwards.
 * http links are dropped -- the desk cites https only -- and the list is
 * capped so one chatty run cannot fill the column.
 */
export function claimsAndSourcesUrls(body: string, max = 40): string[] {
  const lines = String(body ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toUpperCase() === "CLAIMS AND SOURCES");
  if (start === -1) return [];
  const seen = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    for (const match of line.matchAll(/https?:\/\/[^\s<>()"']+/gi)) {
      // A link at the end of a sentence arrives with the period on it.
      const url = match[0].replace(/[.,;:]+$/, "");
      if (/^https:\/\//i.test(url)) seen.add(url);
    }
  }
  return [...seen].slice(0, Math.max(0, max));
}

/**
 * The editor's pre-publication checklist, as plain lines.
 *
 * The agent writes it as sentences, but a bullet or a number can slip in; the
 * story page shows these as a list, so the mark is stripped and the sentence
 * kept. At most 3 survive, the first 3 in the file (Scott's rule, Oct 7 and
 * D204: an editor checks 1 to 3 things, not thirty). The agent already ranks
 * them most harmful first; the app holds the cap even if it sends more.
 */
export function parseCheckFirst(text: string): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^(?:[-*•·–—]+|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}
