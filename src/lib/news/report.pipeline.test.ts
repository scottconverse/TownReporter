import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_RESEARCH_SYSTEM,
  REPORT_WRITE_SYSTEM,
  looksLikeRewrite,
  reportAndDraft,
  resolvePublicFindings,
  type FetchedDoc,
  type ReportChat,
} from "./report.ts";
import type { LeadRow } from "./types.ts";

const ANNOUNCE = "https://longmontcolorado.gov/news/group-2-begins.html";
const ATTACH = "https://longmontcolorado.gov/docs/group-2-crossings.pdf";
const PACKET = "https://longmontcolorado.gov/agendas/2026-08-25-packet.pdf";
const CONTRACT = "https://longmontcolorado.gov/purchasing/acme-group-2.html";
const MINUTES = "https://longmontcolorado.gov/minutes/2026-06-10.html";
const DELAY = "https://longmontcolorado.gov/utilities/valve-delay.html";

function pagesForPacket() {
  return Array.from({ length: 200 }, (_, i) => {
    const page = i + 1;
    if (page === 1) {
      return { page, text: "City announcement: Group 2 construction begins August 31." };
    }
    if (page === 60) {
      return { page, text: "The Group 2 contract is $2.4 million with Acme Holdings LLC." };
    }
    if (page === 140) {
      return { page, text: "Amendment 3 shifts completion from June 2027 to March 2028." };
    }
    if (page === 180) {
      return {
        page,
        text: "Staff now says the project was delayed from June because of a valve shortage.",
      };
    }
    return { page, text: `Filler page ${page} of the civic packet.` };
  });
}

const DOCS: Record<string, FetchedDoc> = {
  [ANNOUNCE]: {
    url: ANNOUNCE,
    title: "Group 2 construction begins August 31",
    text: "The City of Longmont announced that construction on the Group 2 waterline replacement will begin August 31. See attachment.",
    extras: [ATTACH],
  },
  [ATTACH]: {
    url: ATTACH,
    title: "Group 2 affected crossings",
    text: "Affected crossings: Hover Street at 9th and 17th. Lane closures for six weeks.",
    extras: [],
  },
  [PACKET]: {
    url: PACKET,
    title: "August 25 council packet",
    text: pagesForPacket()
      .map((p) => p.text)
      .join("\n\n"),
    extras: [],
    pages: pagesForPacket(),
  },
  [CONTRACT]: {
    url: CONTRACT,
    title: "Acme Group 2 award",
    text: "Acme Holdings LLC was awarded the Group 2 waterline contract for $2.4 million.",
    extras: [],
  },
  [MINUTES]: {
    url: MINUTES,
    title: "June 10 council minutes",
    text: "Council previously scheduled Group 2 to start in June 2026, pending materials.",
    extras: [],
  },
  [DELAY]: {
    url: DELAY,
    title: "Valve shortage delay",
    text: "Utilities staff said a valve shortage pushed Group 2 from June to August 31.",
    extras: [],
  },
};

const lead: LeadRow = {
  id: 1,
  headline: "Group 2 construction begins August 31",
  why: "City announcement of waterline work",
  topic: "utilities",
  status: "new",
  source_urls: JSON.stringify([ANNOUNCE]),
  evidence: "",
  newsworthiness: 12,
  created_at: new Date().toISOString(),
};

describe("reportAndDraft pipeline", { timeout: 30000 }, () => {
  it("follows the trail, retrieves deep packet facts, and does not treat grounding as a rewrite", async () => {
    const writePackets: string[] = [];
    let versions = 10;
    const chat: ReportChat = async (system, user) => {
      if (system === REPORT_RESEARCH_SYSTEM) {
        return {
          ok: true,
          text: JSON.stringify({
            news: "Group 2 waterline work starts August 31 after a delay from June.",
            why_it_matters: "Hover Street crossings close for six weeks.",
            angle: "delayed Group 2 waterline start",
            form: "reported",
            questions: ["What does Group 2 cover?", "Why the delay?", "What does it cost?"],
            fetch_urls: [PACKET],
            unknowns: ["which hydrants go offline"],
            follow: "prior schedule, contract amount, Group 2 definition",
            lanes: {
              context: ["Group 2 waterline prior schedule Longmont"],
              stakeholders: ["Group 2 Hover Street residents Longmont"],
              contradiction: ["Group 2 delay valve shortage Longmont"],
              gaps: ["Group 2 contract amount Longmont"],
            },
          }),
        };
      }
      if (system === REPORT_WRITE_SYSTEM) {
        writePackets.push(user);
        return {
          ok: true,
          text: JSON.stringify({
            headline: "Group 2 waterline work starts Aug. 31 after June delay, packet shows $2.4 million",
            dek: "Hover Street crossings close for six weeks. A valve shortage pushed the job from June.",
            body: [
              "Longmont will shut parts of Hover Street at 9th and 17th starting August 31 as crews replace Group 2 water lines, a phase the August 25 packet describes as the stretch between those crossings.",
              "The same packet lists the Acme Holdings contract at $2.4 million. Amendment 3 moves completion from June 2027 to March 2028.",
              "June minutes had the start in June. Utilities staff later said a valve shortage caused the slip to August 31.",
              "What the announcing release does not say is which hydrants go offline.",
            ].join("\n\n"),
            topic: "utilities",
            source_urls: [ANNOUNCE, ATTACH, PACKET, CONTRACT, MINUTES, DELAY],
            integrity_notes: "Confirm hydrant list with utilities.",
            memory_entities: ["Group 2", "Acme Holdings"],
            form: "reported",
            found: {
              text: "The council packet lists the Group 2 contract at $2.4 million and a valve-shortage delay from June.",
              source_urls: [PACKET, DELAY],
              locators: ["page:60", "page:180"],
            },
            unanswered: ["which hydrants go offline"],
            reporting_trail: [
              {
                title: "Group 2 construction begins August 31",
                organization: "City of Longmont",
                document_date: "2026-08-12",
                url: ANNOUNCE,
                role: "announcing-source",
              },
              {
                title: "August 25 council packet",
                organization: "City of Longmont",
                document_date: "2026-08-25",
                url: PACKET,
                role: "packet",
              },
            ],
          }),
        };
      }
      return { ok: true, text: "{}" };
    };

    const result = await reportAndDraft(
      { userId: "pipeline-test", lead, urls: [ANNOUNCE], memory: [] },
      {
        ingest: async (url) => DOCS[url] ?? { url, title: url, text: "", extras: [] },
        search: async (q) => {
          const hits = [];
          if (/prior|previous|schedule|2025|context/i.test(q)) hits.push({ title: "minutes", url: MINUTES });
          if (/contract|amount|cost|gap/i.test(q)) hits.push({ title: "award", url: CONTRACT });
          if (/delay|valve|shortage|contradiction/i.test(q)) hits.push({ title: "delay", url: DELAY });
          if (/Hover|stakeholder|resident/i.test(q)) hits.push({ title: "crossings", url: ATTACH });
          return hits;
        },
        chat,
        capture: async (_user, _doc) => ({
          version_id: ++versions,
          capture_event_id: versions + 100,
        }),
        hydrate: async (_user, urls) =>
          urls.map((url, i) => ({
            url,
            captured_at: "2026-08-25T15:00:00.000Z",
            version_id: 20 + i,
            version_count: url === PACKET ? 3 : 1,
            disappeared: false,
          })),
      },
    );

    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;

    assert.match(result.headline, /\$2\.4 million|Group 2/i);
    assert.match(result.body, /Hover Street/);
    assert.match(result.body, /\$2\.4 million/);
    assert.match(result.body, /valve shortage/);
    assert.match(result.body, /hydrants/);
    assert.equal(result.form, "reported");
    assert.ok(result.source_urls.includes(PACKET));
    assert.ok(result.source_urls.every((u) => u.startsWith("https://")));
    assert.doesNotMatch(result.body, /construction begins August 31[\s\S]*construction begins August 31[\s\S]*construction begins August 31/);

    const packetWrite = writePackets.join("\n");
    assert.match(packetWrite, /\$2\.4 million/);
    assert.match(packetWrite, /Amendment 3|valve shortage/);
    assert.ok(/page:60|page:140|page:180|LOCATOR/.test(packetWrite));

    const announce = DOCS[ANNOUNCE]!.text;
    assert.equal(looksLikeRewrite(result.body, announce), false);

    const packetProv = result.provenance.find((p) => p.url === PACKET);
    assert.ok(packetProv);
    assert.equal(packetProv!.url, PACKET);
    assert.ok(packetProv!.captured_at);
    assert.ok((packetProv!.version_count ?? 0) >= 1);

    const trail = result.provenance.find((p) => p.url === ANNOUNCE);
    assert.ok(trail);
    assert.match(trail!.title, /Group 2/i);

    const published = resolvePublicFindings(result.findings, result.provenance);
    assert.ok(published.length >= 1);
    assert.match(published[0]!.text, /\$2\.4 million/);
    assert.ok(result.unanswered.some((q) => /hydrant/i.test(q)));
  });

  it("runs one search per reporting lane even when research proposes four context queries", async () => {
    const searches: string[] = [];
    const chat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM) {
        return {
          ok: true,
          text: JSON.stringify({
            news: "Group 2 starts August 31.",
            why_it_matters: "Hover Street closes.",
            angle: "Group 2 start",
            form: "reported",
            questions: ["cost?"],
            fetch_urls: [],
            unknowns: ["hydrants"],
            follow: "prior packet",
            lanes: {
              context: [
                "CTX-1 Group 2 prior schedule Longmont",
                "CTX-2 Group 2 2025 contract Longmont",
                "CTX-3 Group 2 earlier phase Longmont",
                "CTX-4 Group 2 council history Longmont",
              ],
              stakeholders: ["STK-1 Group 2 Hover Street residents Longmont"],
              contradiction: ["CTR-1 Group 2 delay valve shortage Longmont"],
              gaps: ["GAP-1 Group 2 contract amount Longmont"],
            },
          }),
        };
      }
      if (system === REPORT_WRITE_SYSTEM) {
        return {
          ok: true,
          text: JSON.stringify({
            headline: "Group 2 waterline work starts Aug. 31",
            dek: "Hover Street crossings close.",
            body: "Longmont will shut parts of Hover Street starting August 31. The packet lists a $2.4 million Acme contract after a valve-shortage delay from June.",
            topic: "utilities",
            source_urls: [ANNOUNCE],
            form: "reported",
            found: null,
            unanswered: [],
            reporting_trail: [],
          }),
        };
      }
      return { ok: true, text: "{}" };
    };

    const result = await reportAndDraft(
      { userId: "lane-budget", lead, urls: [ANNOUNCE], memory: [] },
      {
        ingest: async (url) => DOCS[url] ?? { url, title: url, text: "", extras: [] },
        search: async (q) => {
          searches.push(q);
          return [];
        },
        chat,
        capture: async () => ({ version_id: 1, capture_event_id: 1 }),
        hydrate: async () => [],
      },
    );
    assert.ok(!("error" in result));
    const laneSearches = searches.filter((q) => /^(CTX|STK|CTR|GAP)-/.test(q));
    assert.equal(laneSearches.length, 4);
    assert.equal(laneSearches.filter((q) => q.startsWith("CTX-")).length, 1);
    assert.ok(laneSearches.some((q) => q.startsWith("STK-")));
    assert.ok(laneSearches.some((q) => q.startsWith("CTR-")));
    assert.ok(laneSearches.some((q) => q.startsWith("GAP-")));
  });

  it("promotes a brief candidate after a challenge finds a $3.7 million remediation", async () => {
    const PARK = "https://longmontcolorado.gov/news/park-closes.html";
    const REMEDIATION = "https://longmontcolorado.gov/public-works/sunset-remediation.pdf";
    const searches: string[] = [];
    let promotedLanes = false;
    const chat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM) {
        return {
          ok: true,
          text: JSON.stringify({
            news: "Sunset Park closes Monday.",
            why_it_matters: "The park will be fenced.",
            angle: "park closure",
            form: "brief",
            questions: [],
            fetch_urls: [],
            unknowns: [],
            follow: "",
            lanes: {
              context: ["Sunset Park prior work Longmont"],
              stakeholders: ["Sunset Park neighbors Longmont"],
              contradiction: ["Sunset Park remediation cost Longmont"],
              gaps: ["Sunset Park duration Longmont"],
            },
          }),
        };
      }
      if (system === REPORT_WRITE_SYSTEM) {
        promotedLanes = true;
        return {
          ok: true,
          text: JSON.stringify({
            headline: "Sunset Park closes Monday for $3.7 million remediation",
            dek: "A soil cleanup, not a routine lockup.",
            body: "Sunset Park closes Monday because a $3.7 million remediation project begins, city public-works records show. Neighbors along Collyer will lose the playground for the season.",
            topic: "planning",
            source_urls: [PARK, REMEDIATION],
            form: "reported",
            found: {
              text: "Public-works records list the cleanup at $3.7 million.",
              source_urls: [REMEDIATION],
              locators: ["page:1"],
            },
            unanswered: [],
            reporting_trail: [],
          }),
        };
      }
      return { ok: true, text: "{}" };
    };
    const parkLead: LeadRow = {
      ...lead,
      headline: "Park closure begins Monday",
      why: "City announcement of a park closure",
      topic: "planning",
      source_urls: JSON.stringify([PARK]),
    };
    const result = await reportAndDraft(
      { userId: "brief-promote", lead: parkLead, urls: [PARK], memory: [] },
      {
        ingest: async (url) => {
          if (url === PARK) {
            return {
              url,
              title: "Park closure begins Monday",
              text: "Sunset Park closes Monday.",
              extras: [],
            };
          }
          if (url === REMEDIATION) {
            return {
              url,
              title: "Sunset Park remediation",
              text: "The park is closing because a $3.7 million remediation project begins Monday.",
              extras: [],
            };
          }
          return { url, title: url, text: "", extras: [] };
        },
        search: async (q) => {
          searches.push(q);
          return [{ title: "remediation", url: REMEDIATION, snippet: "$3.7 million remediation" }];
        },
        chat,
        capture: async (_u, doc) => ({
          version_id: doc.url === REMEDIATION ? 44 : 43,
          capture_event_id: doc.url === REMEDIATION ? 144 : 143,
        }),
        hydrate: async (_u, urls) =>
          urls.map((url) => ({
            url,
            version_id: url === REMEDIATION ? 44 : 43,
            capture_event_id: url === REMEDIATION ? 144 : 143,
            captured_at: "2026-08-25T15:00:00.000Z",
            disappeared: false,
          })),
      },
    );
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;
    assert.equal(result.form, "reported");
    assert.ok(promotedLanes);
    assert.ok(searches.length >= 5);
    assert.match(result.body, /\$3\.7 million/);
    const published = resolvePublicFindings(result.findings, result.provenance);
    assert.equal(published.length, 1);
  });

  it("keeps a genuine maintenance notice a brief after a fruitless challenge", async () => {
    const LIB = "https://longmontcolorado.gov/library/hours.html";
    const searches: string[] = [];
    const chat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM) {
        return {
          ok: true,
          text: JSON.stringify({
            news: "Library closes two hours early Friday.",
            why_it_matters: "Friday evening hours change once.",
            angle: "library hours",
            form: "brief",
            questions: [],
            fetch_urls: [],
            unknowns: [],
            follow: "",
            lanes: { context: [], stakeholders: [], contradiction: [], gaps: [] },
          }),
        };
      }
      return {
        ok: true,
        text: JSON.stringify({
          headline: "Library closes two hours early Friday for maintenance",
          dek: "A one-night HVAC check.",
          body: "The Longmont Public Library will close at 6 p.m. Friday, two hours early, for scheduled maintenance.",
          topic: "about",
          source_urls: [LIB],
          form: "brief",
          found: null,
          unanswered: [],
          reporting_trail: [],
        }),
      };
    };
    const libLead: LeadRow = {
      ...lead,
      headline: "Library closes two hours early for scheduled maintenance",
      why: "Hours notice",
      topic: "about",
      source_urls: JSON.stringify([LIB]),
    };
    const result = await reportAndDraft(
      { userId: "brief-keep", lead: libLead, urls: [LIB], memory: [] },
      {
        ingest: async (url) => ({
          url,
          title: "Library hours",
          text: "The Longmont Public Library closes two hours early Friday for scheduled maintenance.",
          extras: [],
        }),
        search: async (q) => {
          searches.push(q);
          return [];
        },
        chat,
        capture: async () => ({ version_id: 8, capture_event_id: 18 }),
        hydrate: async (_u, urls) =>
          urls.map((url) => ({
            url,
            version_id: 8,
            capture_event_id: 18,
            captured_at: "2026-08-25T15:00:00.000Z",
            disappeared: false,
          })),
      },
    );
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;
    assert.equal(result.form, "brief");
    assert.equal(searches.length, 1);
  });

  it("still writes when extra fetches would hang past the draft budget", { timeout: 5000 }, async () => {
    let extraCalls = 0;
    const chat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM) {
        return {
          ok: true,
          text: JSON.stringify({
            news: "Airport noise rules are voluntary abatement only.",
            why_it_matters: "Vance Brand neighbors cannot get a ban.",
            angle: "no ban on noisy planes",
            form: "explainer",
            questions: [],
            fetch_urls: [PACKET],
            unknowns: [],
            follow: "",
            lanes: { context: ["hang forever"] },
          }),
        };
      }
      return {
        ok: true,
        text: JSON.stringify({
          headline: "Longmont cannot simply ban noisy planes at Vance Brand Airport",
          dek: "Noise abatement is voluntary.",
          body: "The city cannot impose a simple ban on noisy aircraft at Vance Brand Airport. The current path is voluntary noise abatement, not a prohibition.\n\nNeighbors have asked for a ban. The records in front of the desk do not show one.",
          topic: "infrastructure",
          source_urls: [ANNOUNCE],
          form: "explainer",
          found: [],
          unanswered: [],
        }),
      };
    };
    const result = await reportAndDraft(
      { userId: "budget", lead, urls: [ANNOUNCE], memory: [] },
      {
        budgetMs: 10_000,
        ingest: async (url) => {
          if (url === ANNOUNCE) return DOCS[ANNOUNCE]!;
          extraCalls += 1;
          await new Promise(() => {});
          return { url, title: url, text: "", extras: [] };
        },
        search: async () => {
          extraCalls += 1;
          await new Promise(() => {});
          return [];
        },
        chat,
        capture: async () => ({ version_id: 1, capture_event_id: 2 }),
        hydrate: async () => [],
      },
    );
    assert.equal(extraCalls, 0);
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;
    assert.match(result.body, /voluntary noise/i);
  });

  it("credits the originating Leader story URL, not the homepage listing", async () => {
    const HOME = "https://www.longmontleader.com/";
    const INDEX = "https://www.longmontleader.com/local-news";
    const STORY =
      "https://www.longmontleader.com/local-news/why-longmont-cant-simply-ban-noisy-airplanes-at-vance-brand-airport-123";
    const airportLead: LeadRow = {
      ...lead,
      headline: "Why Longmont Can't Simply Ban Noisy Airplanes at Vance Brand Airport",
      why: "Leader explainer on airport noise",
      topic: "infrastructure",
      source_urls: JSON.stringify([HOME, INDEX]),
    };
    const chat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM) {
        return {
          ok: true,
          text: JSON.stringify({
            news: "The city cannot simply ban noisy aircraft at Vance Brand.",
            why_it_matters: "Neighbors have asked for a ban.",
            angle: "airport noise ban",
            form: "explainer",
            questions: [],
            fetch_urls: [],
            unknowns: [],
            follow: "",
            lanes: { context: [], stakeholders: [], contradiction: [], gaps: [] },
          }),
        };
      }
      return {
        ok: true,
        text: JSON.stringify({
          headline: "Longmont cannot simply ban noisy planes at Vance Brand Airport",
          dek: "Noise abatement is voluntary.",
          body: "The Longmont Leader reported that the city cannot impose a simple ban on noisy aircraft at Vance Brand Airport.",
          topic: "infrastructure",
          source_urls: [HOME, INDEX],
          form: "explainer",
          found: [],
          unanswered: [],
        }),
      };
    };
    const result = await reportAndDraft(
      { userId: "credit", lead: airportLead, urls: [HOME, INDEX], memory: [] },
      {
        ingest: async (url) => {
          if (url === HOME || url === INDEX) {
            return {
              url,
              title: "Local news",
              text: "Local news listing. Why Longmont Can't Simply Ban Noisy Airplanes at Vance Brand Airport.",
              extras: [STORY],
            };
          }
          if (url === STORY) {
            return {
              url,
              title: "Why Longmont Can't Simply Ban Noisy Airplanes at Vance Brand Airport",
              text: "Federal rules and the airport's grant assurances mean the city cannot simply ban noisy aircraft. The current path is voluntary noise abatement.",
              extras: [],
            };
          }
          return { url, title: url, text: "", extras: [] };
        },
        search: async () => [],
        chat,
        capture: async () => ({ version_id: 3, capture_event_id: 4 }),
        hydrate: async () => [],
      },
    );
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;
    assert.equal(result.source_urls[0], STORY);
    assert.match(
      result.body,
      /\[Longmont Leader\]\(https:\/\/www\.longmontleader\.com\/local-news\/why-longmont/,
    );
    assert.equal(
      result.unanswered.some((u) => /full url of the originating story/i.test(u)),
      false,
    );
  });

  it("fetches the company's own press release, not just the listing that led there", async () => {
    const HOME = "https://www.longmontleader.com/";
    const PR =
      "https://ursamajor.com/media/press-release/ursa-major-opens-new-longmont-manufacturing-facility/";
    const writePackets: string[] = [];
    const searches: string[] = [];
    const ingested: string[] = [];
    const plantLead: LeadRow = {
      ...lead,
      headline: "Ursa Major opens new Longmont manufacturing facility",
      why: "Longmont Leader homepage item",
      topic: "infrastructure",
      source_urls: JSON.stringify([HOME]),
    };
    const chat: ReportChat = async (system, user) => {
      if (system === REPORT_RESEARCH_SYSTEM) {
        return {
          ok: true,
          text: JSON.stringify({
            news: "Ursa Major opened a manufacturing facility in Longmont.",
            why_it_matters: "Jobs and industrial tax base.",
            angle: "company plant, not a rewrite of the Leader",
            form: "reported",
            questions: ["How many jobs?", "Square footage?"],
            fetch_urls: [PR],
            unknowns: [],
            follow: "company press release",
            lanes: { context: [], stakeholders: [], contradiction: [], gaps: [] },
          }),
        };
      }
      if (system === REPORT_WRITE_SYSTEM) {
        writePackets.push(user);
        return {
          ok: true,
          text: JSON.stringify({
            headline: "Ursa Major opens a Longmont manufacturing plant",
            dek: "The company’s own release lists the facility.",
            body: "Ursa Major opened a manufacturing facility in Longmont, the company said in a press release. The Longmont Leader first noted the opening.",
            topic: "infrastructure",
            source_urls: [PR, HOME],
            form: "reported",
            found: null,
            unanswered: [],
            claims: [
              {
                fact: "Ursa Major opened a Longmont manufacturing facility",
                url: PR,
                kind: "primary",
              },
            ],
            reporting_trail: [{ title: "press release", organization: "Ursa Major", url: PR, role: "primary" }],
          }),
        };
      }
      return { ok: true, text: "{}" };
    };
    const result = await reportAndDraft(
      { userId: "ursa-test", lead: plantLead, urls: [HOME], memory: [] },
      {
        ingest: async (url) => {
          ingested.push(url);
          if (url === PR) {
            return {
              url: PR,
              title: "Ursa Major Opens New Longmont Manufacturing Facility",
              text: "Ursa Major Technologies today opened a new manufacturing facility in Longmont, Colorado. The plant will support propulsion production.",
              extras: [],
            };
          }
          return {
            url,
            title: "Longmont Leader",
            text: "Local news. Ursa Major opens plant. Read more.",
            extras: [],
          };
        },
        search: async (q) => {
          searches.push(q);
          if (/press release|ursa major/i.test(q)) {
            return [{ title: "Ursa Major press release", url: PR, snippet: "company announcement" }];
          }
          return [];
        },
        chat,
        capture: async () => ({ version_id: 1, capture_event_id: 1 }),
        hydrate: async () => [],
        budgetMs: 120_000,
      },
    );
    if ("error" in result) throw new Error(result.error);
    assert.ok(searches.some((q) => /press release/i.test(q)), "should search for a press release");
    assert.ok(ingested.includes(PR), `should fetch the company PR, got ${ingested.join(", ")}`);
    assert.ok(writePackets.some((p) => p.includes(PR)), "write pass should see the PR URL");
    assert.ok(result.claims.some((c) => c.kind === "primary" && c.url === PR));
  });
});
