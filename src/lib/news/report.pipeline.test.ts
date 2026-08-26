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
        capture: async (_user, doc) => ({
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
});
