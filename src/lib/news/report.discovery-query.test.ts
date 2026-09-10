import assert from "node:assert/strict";
import { it } from "node:test";
import { reportAndDraft, discoveredDocumentMatches } from "./report.ts";
import type { LeadRow } from "./types.ts";

it("an archive sidebar cannot qualify an unrelated result for a street-project query", async () => {
  const seed = "https://longmontcolorado.gov/news/";
  const noise = "https://medicare.gov/pace";
  const captured: string[] = [];
  const packets: string[] = [];
  const lead: LeadRow = { id: 1, headline: "Pace Street construction changes driveway access", why: "Roadwork affects shopping traffic", topic: "infrastructure", status: "new", source_urls: JSON.stringify([seed]), evidence: "", newsworthiness: 12, created_at: "2026-09-09" };
  await reportAndDraft({ userId: "discovery-query", lead, urls: [seed], memory: [], modelChoice: "claude-frontier" }, {
    paper: async () => ({ name: "TownReporter", city: "Longmont", state: "Colorado", officialDomains: [] }),
    search: async () => [{url: noise, title: "Medicare PACE assistance program"}],
    ingest: async (url) => ({url, title: url === seed ? "City news" : "Medicare PACE", text: url === seed
      ? "Pace Street construction changes driveway access. Elsewhere in the archive: pharmaceutical assistance program information."
      : "UNRELATED-PACE-RESULT: pharmaceutical assistance program enrollment for Medicare patients.", extras: []}),
    capture: async (_user, doc) => { captured.push(doc.url); return {version_id: 1, capture_event_id: 1}; },
    hydrate: async () => [],
    chat: async (system, user) => {
      packets.push(user);
      return {ok: true, text: JSON.stringify(system.includes('"fetch_urls"')
        ? {news: lead.headline, form: "reported", lanes: {context: ["Pace Street Longmont construction driveway"]}}
        : {headline: lead.headline, body: "Pace Street construction changes driveway access, according to the city notice.", topic: lead.topic, source_urls: [seed]})};
    },
  });
  assert.ok(captured.includes(seed), "operator-supplied source remains readable");
  assert.ok(!captured.includes(noise), "unrelated result must not enter captured reporting evidence through archive-wide overlap");
  assert.ok(packets.every(packet => !packet.includes("UNRELATED-PACE-RESULT")));
});

it("query-specific existing matching preserves named entities and community coverage", () => {
  assert.equal(discoveredDocumentMatches("Infleqtion announced a national award", "Infleqtion"), true);
  assert.equal(discoveredDocumentMatches("Neighbors discuss driveway work on Pace Street", "Pace Street Longmont construction"), true);
  assert.equal(discoveredDocumentMatches("Medicare PACE assistance program", "Pace Street Longmont construction"), false);
  assert.equal(discoveredDocumentMatches("Fox News national headlines", "Fox Creek Longmont driveway closure"), false);
});
