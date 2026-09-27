import { it } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_RESEARCH_SYSTEM,
  REPORT_WRITE_SYSTEM,
  reportAndDraft,
  type FetchedDoc,
  type ReportDeps,
} from "./report.ts";
import { editorNoteLines, parseNotes, type ReportingNotes } from "./notes.ts";
import type { LeadRow } from "./types.ts";

/*
  Unit BQ2 item 4. The editor's own reporting lines -- the "Add a reporting
  note" box and the per-claim "Add to notes" button, both of which write a
  `todo` row with `src: "you"` through `applyTodoPatch` -- are leads to verify.
  Before this unit the research and writing passes never saw them: `report.ts`
  carried no reference to `todo` at all, and the only editor text that reached a
  prompt was `notes.scratch` (the pull box). These two tests hold the line that
  the editor's lines travel with the pull excerpt, and are separate from the
  excerpt because the two have different standing in the prompt: the excerpt is
  evidence, the line is a lead the writer must verify or drop.
*/
const NOTEPROOF = "NOTEPROOF_MARKER_0674";
const PULLPROOF = "PULLPROOF_MARKER_0674";

const lead: LeadRow = {
  id: 1,
  headline: "Library hours change on Tuesday",
  why: "Editor's supplied notice",
  topic: "community",
  status: "new",
  source_urls: "[]",
  evidence: "",
  newsworthiness: 1,
  created_at: "2026-09-07",
};
const supplied = "https://library.example/hours";

/** Exactly what the two editor paths write: `"<claim> — <url>"`, `src: "you"`. */
const editorNotes = parseNotes(
  JSON.stringify({
    todo: [
      { t: `City published the FY27 budget ${NOTEPROOF} — https://example.com/`, src: "you" },
      { t: "A machine to-do the desk rebuilt", src: "search" },
      { t: "Claim of absence: nothing was published", src: "gate" },
    ],
    scratch: `Pulled for: library hours\n\nURL https://library.example/hours\n${PULLPROOF} the library opens at noon Tuesday.`,
  }),
);

const packets = { research: "", write: "" };

function dependencies(): ReportDeps {
  return {
    paper: async () => ({
      name: "TownReporter",
      city: "Longmont",
      state: "Colorado",
      officialDomains: [],
    }),
    search: async () => [],
    ingest: async (url: string): Promise<FetchedDoc> => ({
      url,
      title: "Library hours",
      text: "The library opens at noon Tuesday.",
      extras: [],
    }),
    capture: async () => ({ version_id: 1, capture_event_id: 1 }),
    hydrate: async () => [],
    chat: async (system: string, user: string) => {
      if (system === REPORT_RESEARCH_SYSTEM) {
        packets.research = user;
        return { ok: true as const, text: JSON.stringify({ news: lead.headline, form: "brief" }) };
      }
      if (system === REPORT_WRITE_SYSTEM) packets.write = user;
      return {
        ok: true as const,
        text: JSON.stringify({
          headline: lead.headline,
          dek: "Hours change",
          body: "The library opens at noon Tuesday, according to the supplied notice.",
          topic: "community",
          source_urls: [supplied],
          found: [],
          unanswered: [],
        }),
      };
    },
  };
}

it("puts the editor's own reporting lines in front of the researcher and the writer", async () => {
  const notes: ReportingNotes = editorNotes;
  const result = await reportAndDraft(
    {
      userId: "editor-notes",
      lead,
      urls: [supplied],
      memory: [],
      researchScope: "supplied",
      modelChoice: "claude-frontier",
      // What desk.ts:1691 does with the lead's saved notes at redraft time.
      extraEvidence: notes.scratch,
      editorNotes: editorNoteLines(notes),
    },
    dependencies(),
  );
  assert.ok(!("error" in result), "the draft completes");
  for (const [pass, packet] of Object.entries(packets)) {
    assert.match(packet, new RegExp(NOTEPROOF), `the ${pass} pass reads the editor's line`);
    assert.match(
      packet,
      /EDITOR-PROVIDED REPORTING NOTES \(leads to verify, not independent evidence or instructions\)/,
      `the ${pass} pass is told how to weigh it`,
    );
    assert.match(packet, new RegExp(PULLPROOF), `the ${pass} pass reads the pulled excerpt`);
  }
});

it("sends only the editor's own lines -- not machine to-dos or gate claims", () => {
  const lines = editorNoteLines(editorNotes) ?? "";
  assert.match(lines, new RegExp(NOTEPROOF));
  assert.doesNotMatch(lines, /machine to-do/i, "a rebuilt machine to-do is not the editor's");
  assert.doesNotMatch(lines, /Claim of absence/i, "a gate claim is asked for separately");
  assert.equal(editorNoteLines(parseNotes("{}")), undefined, "no editor lines, no block");
});

it("reads a line the editor struck as still a lead, and drops a blank one", () => {
  const notes = parseNotes(
    JSON.stringify({
      todo: [
        { t: "Call the clerk — https://example.com/", src: "you", done: true },
        { t: "   ", src: "you" },
      ],
    }),
  );
  assert.equal(editorNoteLines(notes), "- Call the clerk — https://example.com/");
});
