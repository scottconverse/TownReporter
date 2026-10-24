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

/**
 * The assignment handed to the agent for an ordinary NEWS lead.
 *
 * The same job as `assignmentPrompt`, handed the same way, for the other kind
 * of lead the skill writes: one straight story about one lead, researched from
 * public records, with no meeting, no transcript and no packet. This text is
 * the arm-C harness's prompt (writer-test-c/harness/run-c.mjs lines 75-100)
 * word for word -- the wording is the thing that was measured in the blind
 * test, so it is copied rather than improved.
 */
export function newsAssignmentPrompt(input: {
  /** The lead's headline, as the desk holds it. */
  headline: string;
  /** The lead's topic, as the desk holds it. */
  topic: string;
  /** Today's date, as the editor's desk would say it (e.g. "Wednesday, Oct. 21, 2026"). */
  today: string;
}): string {
  return [
    `Your instructions are the file SKILL.md in your working folder. Read ALL of it first, every line, then follow it exactly. It is the only rule set for this job. Today is ${input.today} (America/Denver).`,
    "",
    "## The assignment (what the editor's desk hands you)",
    `- Write ONE straight local news story about ONE lead: "${input.headline}" (topic: ${input.topic}). Full story mode. This is not a meeting: there is no transcript, no packet, no ALSO AT THE MEETING section, and no ledger.`,
    "- The lead, its evidence and every source URL are in LEAD.md in your working folder. Read all of it. Open every source URL it lists, and follow what they lead to.",
    "- Research it yourself from public records and public reporting: the agency, city, county or state record the lead names (clerks, recorders, filings, agendas, resolutions, notice pages, TRACER, dashboards), and any other outlet's account of the same event. Use curl and pdftotext in the shell; web tools may not work here.",
    "- The audit script is at scripts/audit.py. Run it with: python scripts/audit.py draft.txt",
    "",
    "## Output",
    "- Write the full deliverable (both blocks, exactly as the skill lays them out, including the CLAIMS AND SOURCES block and the EDITOR FILE) to story.txt in your working folder. Keep draft.txt for the script runs.",
    "- Write the script's final run output to audit-final.txt.",
    "- Write CHECK-FIRST.txt: AT MOST 3 lines, the items an editor must check before publishing that would do the most harm if wrong, most harmful first: a sentence with legal risk, then the lead's central fact or number, then a quote or figure that rests on a single source. Everything else you flagged stays in the EDITOR FILE, not here. Plain sentences, one per line. No bullets, no numbering. If nothing rises to that level, write an empty file.",
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

/**
 * The lead file the agent reads (`LEAD.md`), built the way the arm-C harness
 * built it (writer-test-c/harness/run-c.mjs lines 46-66).
 *
 * Everything the desk knows about the lead, laid out in the same headings, so
 * the run folder alone says what the writer was asked to report.
 */
export function newsLeadFile(input: {
  id: number | string;
  headline: string;
  why: string;
  topic: string;
  sourceUrls: readonly string[];
  evidence: string;
  notesJson: string | null;
}): string {
  return [
    `# LEAD ${input.id}`,
    ``,
    `## Headline`,
    input.headline,
    ``,
    `## Why it is news`,
    input.why,
    ``,
    `## Topic`,
    input.topic,
    ``,
    `## Source URLs`,
    ...(input.sourceUrls.length ? input.sourceUrls.map((u) => `- ${u}`) : ["- (none supplied)"]),
    ``,
    `## Evidence`,
    input.evidence,
    ``,
    `## Editor's notes (reporting leads, not established facts)`,
    input.notesJson ?? "",
    ``,
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
  /** Everything publishable except the claims: the story and `ALSO AT THE MEETING`. */
  body: string;
  /**
   * The skill's `CLAIMS AND SOURCES` block, from its heading line on, or ""
   * when the writer wrote none. It is the editor's checking tool, not prose
   * for a reader (D217): the proof run's block was 48 source lines naming the
   * same two records, and readers saw every one of them under the story.
   */
  claims: string;
  /** The marker line and everything after it: never published. */
  editorFile: string;
};

export type SkillStoryFailure = {
  ok: false;
  reason: "missing-marker" | "empty-headline" | "empty-body";
  /** A plain sentence for the editor. */
  error: string;
};

/** The line that opens the skill's claim-by-claim source list. */
export const CLAIMS_AND_SOURCES_HEADING = "CLAIMS AND SOURCES";

/**
 * Split the agent's `story.txt` into the part a reader sees and the part only
 * an editor sees.
 *
 * The skill lays the deliverable out in two blocks separated by a line reading
 * `EDITOR FILE: NOT FOR PUBLICATION`. The publish block is the headline, the
 * dek, and the body.
 *
 * The body keeps `ALSO AT THE MEETING` but NOT `CLAIMS AND SOURCES` (D217).
 * Scott's skill still writes the claim-by-claim list, and it must -- that list
 * is the run's own audit and the reader's guarantee that a fact was checked.
 * But it is the editor's checking tool, not prose: the Oct. 20 proof run's
 * block ran 48 source lines that named the same two records, and a reader
 * scrolling the story saw every one. So the block is cut out of the body here,
 * returned as `claims`, and re-attached to the editor file. A `---` rule just
 * above the heading goes with it, so the body does not end on a stray line.
 *
 * Everything from the marker on is the editor's file: claim checks, the fact
 * sheet, the ledger.
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
  const claimsStart = publish.findIndex(
    (line) => line.trim().toUpperCase() === CLAIMS_AND_SOURCES_HEADING,
  );
  // The claims block runs from its heading to the end of the publish block, plus
  // a horizontal rule just above it when the skill put one there.
  let bodyEnd = publish.length;
  if (claimsStart !== -1) {
    bodyEnd = claimsStart;
    for (let index = claimsStart - 1; index >= 0; index -= 1) {
      const line = publish[index]!.trim();
      if (!line) continue;
      if (line === "---") bodyEnd = index;
      break;
    }
  }
  const body = publish.slice(bodyStart + 1, bodyEnd).join("\n").trim();
  if (!body) {
    return { ok: false, reason: "empty-body", error: "The writer produced a headline but no story." };
  }
  return {
    ok: true,
    headline,
    dek,
    body,
    claims: claimsStart === -1 ? "" : publish.slice(claimsStart).join("\n").trim(),
    editorFile: lines.slice(marker).join("\n").trim(),
  };
}

/**
 * The https sources a CLAIMS AND SOURCES block names.
 *
 * Call it with the story's `claims` (`parseSkillStory`), not its body: since
 * D217 the block is no longer part of the published text, but it is still
 * where the draft's `source_urls` come from -- what the desk checks before
 * publishing and what the reader can follow afterwards. Because the block
 * begins with its own heading, a caller that still holds the whole story can
 * pass that too.
 *
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

/** The lines that end a RUN-NOTES.md "Records opened" list. */
const RUN_NOTES_END_PREFIXES = [
  "what i could not",
  "what could not",
  "could not",
  "script result",
  "final script result",
  "ranking record",
];

/**
 * The https records a run's RUN-NOTES.md says it opened.
 *
 * G23-TE-5 (D264): a run that writes no CLAIMS AND SOURCES block still wrote
 * RUN-NOTES.md, and its "Records opened" part names the pages the agent really
 * read. That part ends where the notes stop being a list of records -- at the
 * next heading, or at the "what could not be got", "script result" or
 * "ranking record" part -- so a URL in the failure notes is never a source.
 * The real files vary: one uses `## Records opened`, another a plain
 * `Records opened (...)` line, and one line may carry a parenthetical note
 * after the URL. Like `claimsAndSourcesUrls`, http links are dropped and the
 * list is capped so one chatty run cannot fill a column.
 */
export function runNotesOpenedUrls(runNotes: string, max = 40): string[] {
  const lines = String(runNotes ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /records opened/i.test(line));
  if (start === -1) return [];
  const seen = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.toUpperCase() === "RUN-DONE") break;
    const words = trimmed.replace(/^#+\s*/, "").toLowerCase();
    if (RUN_NOTES_END_PREFIXES.some((prefix) => words.startsWith(prefix))) break;
    for (const match of line.matchAll(/https?:\/\/[^\s<>()"']+/gi)) {
      // A link at the end of a sentence arrives with the period on it.
      const url = match[0].replace(/[.,;:)]+$/, "");
      if (/^https:\/\//i.test(url)) seen.add(url);
    }
  }
  return [...seen].slice(0, Math.max(0, max));
}

/** AP's month forms: five abbreviated with a period, five short ones spelled out. */
const AP_MONTHS = [
  "Jan.", "Feb.", "March", "April", "May", "June",
  "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec.",
];
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * `Oct. 20, 2026` -- the meeting date the way the paper writes it.
 *
 * The sources line under a meeting story names its date, and a story that read
 * `October 20, 2026` beside every other AP date on the page would mark it as
 * written by somebody who is not an editor. Only the date's own numbers are
 * read -- the month by name or an ISO `YYYY-MM-DD` -- so a time zone can never
 * move the day, and text with no readable date returns "" (the sources line
 * then says `meeting video` with no date rather than guess one).
 */
export function apMeetingDate(date: string): string {
  const raw = String(date ?? "").trim();
  if (!raw) return "";
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(raw);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else {
    const named = /([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(raw);
    if (!named) return "";
    month = MONTH_NAMES.indexOf(named[1]!.toLowerCase());
    day = Number(named[2]);
    year = Number(named[3]);
  }
  if (month < 0 || month > 11 || day < 1 || day > 31) return "";
  return `${AP_MONTHS[month]} ${day}, ${year}`;
}

/**
 * The one sources line that closes a meeting story (D217).
 *
 *   Sources: [Oct. 20, 2026 meeting video](https://www.youtube.com/watch?v=ID) and [council packet](https://...).
 *
 * The claims list that used to carry all of this is now the editor's, so the
 * reader is given the two records the story rests on -- the tape and the
 * packet -- in one sentence. The packet is linked only when the portal lookup
 * actually found THIS meeting's packet: a bare `council packet` is honest, a
 * link to the portal's front page is not.
 */
export function meetingSourcesLine(input: {
  date: string;
  videoId: string;
  title: string;
  packetUrl: string | null;
}): string {
  const dated = apMeetingDate(input.date);
  const videoLabel = dated ? `${dated} meeting video` : "meeting video";
  const videoId = String(input.videoId ?? "").trim();
  const video = videoId
    ? `[${videoLabel}](https://www.youtube.com/watch?v=${videoId})`
    : videoLabel;
  const packetLabel = /council/i.test(String(input.title ?? "")) ? "council packet" : "meeting packet";
  const packetUrl = String(input.packetUrl ?? "").trim();
  const packet = packetUrl ? `[${packetLabel}](${packetUrl})` : packetLabel;
  return `Sources: ${video} and ${packet}.`;
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
