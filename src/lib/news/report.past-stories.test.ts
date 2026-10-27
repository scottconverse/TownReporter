import { it } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_RESEARCH_SYSTEM,
  REPORT_WRITE_SYSTEM,
  reportAndDraft,
  type FetchedDoc,
  type ReportDeps,
} from "./report.ts";
import type { LeadRow } from "./types.ts";

/*
  DEF-1. The writer is told which of the paper's own stories are close in
  meaning, as background so it does not repeat old news. Two things must hold:
  both passes see the list (headline, date, link) with the words that say it is
  background only, and nothing from it ends up in the story. A draft with no
  past stories reads exactly as it did before.
*/
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
const BODY = "The library opens at noon Tuesday, according to the supplied notice.";

const packets = { research: "", write: "" };

function dependencies(): ReportDeps {
  return {
    paper: async () => ({ name: "TownReporter", city: "Longmont", state: "Colorado", officialDomains: [] }),
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
          body: BODY,
          topic: "community",
          source_urls: [supplied],
          found: [],
          unanswered: [],
        }),
      };
    },
  };
}

const input = {
  userId: "past-stories",
  lead,
  urls: [supplied],
  memory: [],
  researchScope: "supplied" as const,
  modelChoice: "claude-frontier" as const,
};

it("shows the researcher and the writer the past stories, as background only, and adds nothing to the story", async () => {
  const result = await reportAndDraft(
    {
      ...input,
      pastStories: [
        { headline: "Library trims weekend hours", date: "Oct 3, 2026", url: "https://paper.example/articles/library-trims" },
        { headline: "Library board meets", date: "Sep 12, 2026", url: "https://paper.example/articles/library-board" },
      ],
    },
    dependencies(),
  );
  assert.ok(!("error" in result), "the draft completes");
  for (const [pass, packet] of Object.entries(packets)) {
    assert.match(packet, /Library trims weekend hours/, `the ${pass} pass sees the headline`);
    assert.match(packet, /Oct 3, 2026/, `the ${pass} pass sees the date`);
    assert.match(packet, /https:\/\/paper\.example\/articles\/library-board/, `the ${pass} pass sees the link`);
    assert.match(packet, /background only/i, `the ${pass} pass is told it is background`);
  }
  // Nothing is added to the story (rule 26).
  assert.equal(result.body, BODY);
  assert.doesNotMatch(JSON.stringify(result), /Library trims weekend hours|paper\.example/);
});

it("leaves the prompts as they were when there are no past stories", async () => {
  packets.research = "";
  packets.write = "";
  const none = await reportAndDraft({ ...input, pastStories: [] }, dependencies());
  assert.ok(!("error" in none));
  const withNone = { ...packets };
  packets.research = "";
  packets.write = "";
  const missing = await reportAndDraft(input, dependencies());
  assert.ok(!("error" in missing));
  assert.doesNotMatch(withNone.research + withNone.write, /OUR PAST STORIES/);
  assert.equal(withNone.research, packets.research);
  assert.equal(withNone.write, packets.write);
});
