import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bestMeetingMatch,
  catalogAndExtras,
  compiledDocumentUrl,
  dateFromTitle,
  minutesGap,
  preferredDocuments,
  scoreMeetingMatch,
  type PrimeGovMeeting,
} from "./primegov.ts";

const avis: PrimeGovMeeting = {
  id: 3781,
  title: "VIRTUAL - Neighborhood Meeting Notice - Avis Car Rental, 206 S. Main St",
  date: "Aug 27, 2026",
  dateTime: "2026-08-27T18:00:00",
  time: "06:00 PM",
  location: "",
  documentList: [
    {
      id: 18556,
      templateId: 17162,
      compileOutputType: 1,
      templateName: "Agenda",
      link: null,
    },
  ],
};

const council: PrimeGovMeeting = {
  id: 3700,
  title: "City Council Regular Session",
  date: "Aug 25, 2026",
  dateTime: "2026-08-25T19:00:00",
  time: "07:00 PM",
  location: "Chambers",
  documentList: [
    { id: 1, templateId: 16373, compileOutputType: 3, templateName: "HTML Agenda", link: null },
    { id: 2, templateId: 16373, compileOutputType: 1, templateName: "Agenda", link: null },
    { id: 3, templateId: 16375, compileOutputType: 1, templateName: "Packet", link: null },
  ],
};

describe("PrimeGov document URLs", () => {
  it("uses templateId on CompiledDocument, not the row id", () => {
    const href = compiledDocumentUrl("https://longmont.primegov.com", avis.documentList[0]!);
    assert.equal(
      href,
      "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=17162&compileOutputType=1",
    );
  });

  it("prefers packet and minutes over HTML agenda", () => {
    const names = preferredDocuments(council).map((d) => d.templateName);
    assert.equal(names[0], "Packet");
    assert.ok(!names.includes("HTML Agenda") || names.indexOf("Packet") < names.indexOf("HTML Agenda"));
  });
});

describe("meeting match", () => {
  it("parses YouTube-style dates", () => {
    assert.equal(dateFromTitle("City Council Regular Session - 08/25/2026"), "2026-08-25");
    assert.equal(dateFromTitle("Aug 27, 2026"), "2026-08-27");
  });

  it("joins 206 S. Main YouTube to the Avis PrimeGov notice", () => {
    const hit = bestMeetingMatch("206 S. Main Street Neighborhood Meeting", [avis, council]);
    assert.equal(hit?.id, 3781);
    assert.ok(scoreMeetingMatch("206 S. Main Street Neighborhood Meeting", avis) >= 40);
  });

  it("joins council session by date and title", () => {
    const hit = bestMeetingMatch("City Council Regular Session - 08/25/2026", [avis, council]);
    assert.equal(hit?.id, 3700);
  });
});

describe("catalog", () => {
  it("lists meetings and emits packet extras", () => {
    const { text, extras } = catalogAndExtras("https://longmont.primegov.com", [avis, council]);
    assert.match(text, /206 S\. Main/);
    assert.match(text, /City Council Regular Session/);
    assert.ok(extras.some((u) => u.includes("16375") || u.includes("17162")));
  });

  it("notes when council minutes have not been posted", () => {
    const old = { ...council, dateTime: "2026-08-20T19:00:00", date: "Aug 20, 2026" };
    const gap = minutesGap(old, new Date("2026-08-26T20:00:00Z"));
    assert.equal(gap, "minutes not posted");
    const withMinutes = {
      ...old,
      documentList: [
        ...old.documentList,
        { id: 9, templateId: 1, compileOutputType: 1, templateName: "Minutes", link: null },
      ],
    };
    assert.equal(minutesGap(withMinutes, new Date("2026-08-26T20:00:00Z")), null);
  });
});
