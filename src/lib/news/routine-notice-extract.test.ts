import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJsonLdEvents, extractPrimeGovMeeting } from "./routine-notice-extract.ts";

const provenance = {
  newsroomId: 4,
  sourceId: 8,
  sourceUrl: "https://town.example/events",
  policyRevision: 2,
  captureEventId: 10,
  artifactVersionId: 12,
  contentHash: "sha256:fixture",
};
const field = (value: string, locator: string) => ({ value, locator });

describe("saved PrimeGov meeting extraction", () => {
  it("maps the existing repository council fixture without using default prose", () => {
    // Reuses the repository regression fixture shape from src/lib/news/primegov.test.ts,
    // blob bdfe4db27e21f98ddb2a958f043121a4e08bdb6d at parent b80b102. It is not
    // claimed as proof of PrimeGov's current public API schema.
    const result = extractPrimeGovMeeting(
      {
        id: 3700,
        title: "City Council Regular Session",
        date: "Aug 25, 2026",
        dateTime: "2026-08-25T19:00:00",
        time: "07:00 PM",
        location: "Chambers",
        documentList: [
          {
            id: 2,
            templateId: 16373,
            compileOutputType: 1,
            templateName: "Agenda",
            link: null,
          },
        ],
      },
      {
        provenance,
        issuer: field("City Council", "caller.approvedIssuer"),
        timezone: field("America/Denver", "paper.timezone"),
        portalOrigin: "https://town.primegov.com",
      },
    );
    assert.equal(result.status, "parsed");
    if (result.status !== "parsed") return;
    assert.equal(result.validation.valid, true);
    if (!result.validation.valid) return;
    assert.equal(result.validation.notice.fields.title.locator, "/title");
    assert.equal(result.validation.notice.fields.start.locator, "/dateTime");
    assert.match(result.validation.notice.fields.agendaUrl.value, /meetingTemplateId=16373/);
    assert.equal(result.validation.notice.fields.agendaUrl.locator, "/documentList/0/templateId");
  });

  it("refuses missing agenda, invalid IDs, and ambiguous time without throwing", () => {
    const context = {
      provenance,
      issuer: field("City Council", "caller.approvedIssuer"),
      portalOrigin: "https://town.primegov.com",
    };
    for (const raw of [
      { id: 0, title: "Meeting", dateTime: "2026-08-25T19:00:00-06:00", location: "Hall" },
      { id: 2, title: "Meeting", dateTime: "2026-08-25T19:00:00-06:00", location: "Hall" },
      {
        id: 2,
        title: "Meeting",
        dateTime: "2026-11-01T01:30:00",
        location: "Hall",
        documentList: [{ id: 1, templateId: 2, templateName: "Agenda", link: null }],
      },
    ]) {
      assert.equal(extractPrimeGovMeeting(raw, context).status, "refused");
    }
  });

  it("never lets an invalid agenda identifier override a valid sibling identifier", () => {
    const result = extractPrimeGovMeeting(
      {
        id: 2,
        title: "Meeting",
        dateTime: "2026-08-25T19:00:00-06:00",
        location: "Hall",
        documentList: [{ id: 7, templateId: -1, templateName: "Agenda", link: null }],
      },
      {
        provenance,
        issuer: field("City Council", "caller.approvedIssuer"),
        portalOrigin: "https://town.primegov.com",
      },
    );
    assert.equal(result.status, "parsed");
    if (result.status !== "parsed" || !result.validation.valid) return;
    const agendaUrl = result.validation.notice.fields.agendaUrl.value;
    assert.match(agendaUrl, /meetingTemplateId=7/);
    assert.doesNotMatch(agendaUrl, /meetingTemplateId=-1/);
  });
});

describe("saved Schema.org Event extraction", () => {
  it("reads events on ordinary category pages with more than 512 KiB of page chrome", () => {
    const event = { "@type": "Event", "@id": "https://town.example/event/arts", name: "Arts evening", startDate: "2026-09-11T18:00:00-06:00", organizer: { name: "Museum" }, location: { "@type": "Place", name: "Museum" } };
    const html = `<div>${" ".repeat(570_000)}</div><script type="application/ld+json">${JSON.stringify(event)}</script>`;
    const result = extractJsonLdEvents(html, { formatKey: "community-arts-event-logistics", provenance });
    assert.equal(result[0]?.status, "parsed");
  });
  it("uses the exact-source owner issuer when organizer is absent and preserves its provenance", () => {
    const events = [
      {
        "@type": "Event",
        "@id": "https://longmontcolorado.gov/event/yoga-storytime/2026-09-10/#event",
        name: "Yoga Storytime",
        startDate: "2026-09-10T10:00:00-06:00",
        endDate: "2026-09-10T10:30:00-06:00",
        eventStatus: "https://schema.org/EventScheduled",
        location: { name: "Longmont Public Library" },
      },
      {
        "@type": "Event",
        "@id":
          "https://longmontcolorado.gov/event/spanish-english-conversation-group-2/2026-09-10/#event",
        name: "Spanish-English Conversation Group",
        startDate: "2026-09-10T13:00:00-06:00",
        endDate: "2026-09-10T14:00:00-06:00",
        eventStatus: "https://schema.org/EventScheduled",
        location: { name: "Longmont Public Library" },
      },
    ];
    const results = extractJsonLdEvents(
      `<script type="application/ld+json">${JSON.stringify(events)}</script>`,
      {
        formatKey: "library-notice",
        provenance,
        ownerIssuer: { value: "City of Longmont", locator: "OWNER_ISSUER" },
      },
    );
    assert.equal(results.length, 2);
    for (const result of results) {
      assert.equal(result.status, "parsed");
      if (result.status === "parsed" && result.validation.valid)
        assert.deepEqual(result.validation.notice.fields.issuer, {
          value: "City of Longmont",
          locator: "OWNER_ISSUER",
        });
    }
  });

  it("refuses rather than overwriting a structured organizer conflicting with owner issuer", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Event", "@id": "conflicting-issuer", name: "Library program", startDate: "2026-09-10T10:00:00-06:00", organizer: { name: "Another Organization" }, location: { name: "Longmont Public Library" } })}</script>`;
    const [result] = extractJsonLdEvents(html, {
      formatKey: "library-notice",
      provenance,
      ownerIssuer: { value: "City of Longmont", locator: "OWNER_ISSUER" },
    });
    assert.equal(result?.status, "refused");
    assert.equal(result?.code, "structurally-invalid");
    assert.match(result?.locator ?? "", /organizer\.name$/);
  });

  it("keeps organizer mandatory when no exact-source owner context is supplied", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Event", "@id": "no-owner-context", name: "Library program", startDate: "2026-09-10T10:00:00-06:00", location: { name: "Longmont Public Library" } })}</script>`;
    const [result] = extractJsonLdEvents(html, { formatKey: "library-notice", provenance });
    assert.equal(result?.status, "refused");
    assert.deepEqual(result?.validation?.valid, false);
  });

  it("reads official Event properties in stable script and graph order", () => {
    // Primary property/value shapes: https://schema.org/Event (retrieved 2026-09-08).
    const html = `<script type="application/ld+json">{
      "@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Ignored"},
        {"@type":"Event","@id":"event-1","name":"Autumn concert",
         "startDate":"2026-11-06T19:00:00-07:00","endDate":"2026-11-06T21:00:00-07:00",
         "organizer":{"@type":"Organization","name":"Town Arts Council"},
         "location":{"@type":"Place","name":"Civic Hall"},
         "url":"https://town.example/concert"}
      ]}</script>`;
    const results = extractJsonLdEvents(html, {
      formatKey: "community-arts-event-logistics",
      provenance,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.status, "parsed");
    if (results[0]?.status !== "parsed" || !results[0].validation.valid) return;
    assert.equal(
      results[0].validation.notice.fields.title.locator,
      "script[0].$['@graph'][1].name",
    );
    assert.equal(results[0].validation.notice.fields.venue.value, "Civic Hall");
  });

  it("keeps a physical Place URL out of online details while retaining a VirtualLocation URL", () => {
    // Mixed-location fixture: the physical Place is from the official Sunset Soiree event;
    // the VirtualLocation is constructed to cover the distinct online-event shape.
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Event",
      "@id": "https://longmontcolorado.gov/event/3rd-annual-sunset-soiree/#event",
      name: "3rd Annual Sunset Soiree",
      startDate: "2026-09-11T18:00:00-06:00",
      organizer: { name: "City of Longmont" },
      location: [
        {
          "@type": "Place",
          name: "Longmont Museum",
          url: "https://longmontcolorado.gov/venue/longmont-museum/",
        },
        { "@type": "VirtualLocation", url: "https://events.example/sunset-stream" },
      ],
    })}</script>`;
    const result = extractJsonLdEvents(html, {
      formatKey: "community-arts-event-logistics",
      provenance,
    })[0];
    assert.equal(result?.status, "parsed");
    if (result?.status !== "parsed") return;
    assert.equal(result.validation.valid, true);
    if (!result.validation.valid) return;
    assert.equal(result.validation.notice.fields.venue?.value, "Longmont Museum");
    assert.equal(
      result.validation.notice.fields.onlineUrl?.value,
      "https://events.example/sunset-stream",
    );
  });

  it("uses caller-selected library or parks context and never classifies from names", () => {
    const html = `<script type="application/ld+json">[{"@type":"Event","@id":"same-event","name":"Story hour","startDate":"2026-09-08T10:00:00-06:00","organizer":{"name":"Library"},"location":{"name":"Room A"}}]</script>`;
    const library = extractJsonLdEvents(html, { formatKey: "library-notice", provenance });
    const parks = extractJsonLdEvents(html, {
      formatKey: "parks-recreation-notice",
      provenance,
    });
    assert.equal(library[0]?.status, "parsed");
    assert.equal(parks[0]?.status, "parsed");
    if (library[0]?.status === "parsed" && library[0].validation.valid) {
      assert.equal(library[0].validation.notice.formatKey, "library-notice");
    }
    if (parks[0]?.status === "parsed" && parks[0].validation.valid) {
      assert.equal(parks[0].validation.notice.formatKey, "parks-recreation-notice");
    }
  });

  it("bounds content and reports malformed or unsupported records explicitly", () => {
    assert.deepEqual(
      extractJsonLdEvents("x".repeat(1_048_577), {
        formatKey: "community-arts-event-logistics",
        provenance,
      }),
      [{ status: "refused", code: "content-too-large", locator: "document" }],
    );
    assert.equal(
      extractJsonLdEvents('<script type="application/ld+json">{broken</script>', {
        formatKey: "community-arts-event-logistics",
        provenance,
      })[0]?.code,
      "malformed-json",
    );
    assert.equal(
      extractJsonLdEvents(
        '<script type="application/ld+json">{"@type":"ChildrensEvent"}</script>',
        {
          formatKey: "community-arts-event-logistics",
          provenance,
        },
      )[0]?.code,
      "unsupported-event-type",
    );

    const scripts = '<script type="application/ld+json">{}</script>'.repeat(33);
    assert.equal(
      extractJsonLdEvents(scripts, {
        formatKey: "community-arts-event-logistics",
        provenance,
      }).at(-1)?.code,
      "script-limit-exceeded",
    );

    const nodes = `<script type="application/ld+json">${JSON.stringify(
      Array.from({ length: 101 }, (_, index) => ({ "@type": "Thing", "@id": index })),
    )}</script>`;
    assert.equal(
      extractJsonLdEvents(nodes, {
        formatKey: "community-arts-event-logistics",
        provenance,
      })[0]?.code,
      "node-limit-exceeded",
    );
  });

  it("refuses an explicit event status outside the supported status contract", () => {
    const html = `<script type="application/ld+json">{"@type":"Event","@id":"unknown-status","name":"Meeting","startDate":"2026-09-08T10:00:00-06:00","organizer":{"name":"Town"},"location":{"name":"Hall"},"eventStatus":"https://schema.org/EventMoved"}</script>`;
    const result = extractJsonLdEvents(html, {
      formatKey: "community-arts-event-logistics",
      provenance,
    })[0];
    assert.equal(result?.status, "refused");
    assert.equal(result?.validation?.valid, false);

    const lookalike = html.replace(
      "https://schema.org/EventMoved",
      "https://attacker.example/NotAnEventCancelled",
    );
    const refusedLookalike = extractJsonLdEvents(lookalike, {
      formatKey: "community-arts-event-logistics",
      provenance,
    })[0];
    assert.equal(refusedLookalike?.status, "refused");
    assert.equal(refusedLookalike?.validation?.valid, false);
  });

  it("preserves and normalizes only exact Schema.org event statuses in every JSON-LD family", () => {
    for (const formatKey of [
      "library-notice",
      "parks-recreation-notice",
      "community-arts-event-logistics",
    ] as const) {
      for (const [rawStatus, normalized] of [
        ["EventScheduled", "scheduled"],
        ["https://schema.org/EventCancelled", "cancelled"],
      ] as const) {
        const html = `<script type="application/ld+json">${JSON.stringify({
          "@type": "Event",
          "@id": `${formatKey}-${normalized}`,
          name: "Town program",
          startDate: "2026-09-08T10:00:00-06:00",
          organizer: { name: "Town" },
          location: { name: "Hall" },
          eventStatus: rawStatus,
        })}</script>`;
        const result = extractJsonLdEvents(html, { formatKey, provenance })[0];
        assert.equal(result?.status, "parsed");
        if (result?.status !== "parsed" || !result.validation.valid) continue;
        assert.equal(result.validation.notice.fields.eventStatus?.value, rawStatus);
        assert.equal(
          result.validation.notice.fields.eventStatus?.locator.endsWith(".eventStatus"),
          true,
        );
        assert.equal(result.validation.notice.normalizedFields.eventStatus, normalized);
      }
    }

    const foreign = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Event",
      "@id": "foreign-status",
      name: "Town program",
      startDate: "2026-09-08T10:00:00-06:00",
      organizer: { name: "Town" },
      location: { name: "Hall" },
      eventStatus: "https://attacker.example/NotAnEventCancelled",
    })}</script>`;
    for (const formatKey of [
      "library-notice",
      "parks-recreation-notice",
      "community-arts-event-logistics",
    ] as const) {
      assert.equal(extractJsonLdEvents(foreign, { formatKey, provenance })[0]?.status, "refused");
    }
  });

  it("distinguishes an absent event status from a malformed supplied status", () => {
    const base = {
      "@type": "Event",
      "@id": "status-shape",
      name: "Town program",
      startDate: "2026-09-08T10:00:00-06:00",
      organizer: { name: "Town" },
      location: { name: "Hall" },
    };
    const resultFor = (row: Record<string, unknown>) =>
      extractJsonLdEvents(`<script type="application/ld+json">${JSON.stringify(row)}</script>`, {
        formatKey: "community-arts-event-logistics",
        provenance,
      })[0];

    assert.equal(resultFor(base)?.status, "parsed");
    for (const eventStatus of [null, 42, {}, [], "   "]) {
      const result = resultFor({ ...base, eventStatus });
      assert.equal(result?.status, "refused");
      assert.equal(result?.code, "structurally-invalid");
      assert.equal(result?.locator.endsWith(".eventStatus"), true);
    }
  });

  it("accepts documented Event identifiers in scalar and array @type values", () => {
    for (const type of [
      "https://schema.org/Event",
      ["https://schema.org/Thing", "http://schema.org/Event"],
    ]) {
      const html = `<script type="application/ld+json">${JSON.stringify({
        "@type": type,
        "@id": "event-type-shape",
        name: "Meeting",
        startDate: "2026-09-08T10:00:00-06:00",
        organizer: { name: "Town" },
        location: { name: "Hall" },
      })}</script>`;
      assert.equal(
        extractJsonLdEvents(html, {
          formatKey: "community-arts-event-logistics",
          provenance,
        })[0]?.status,
        "parsed",
      );
    }
  });

  it("refuses deeply nested JSON-LD without recursive traversal", () => {
    const depth = 10_000;
    const html = `<script type="application/ld+json">${"[".repeat(depth)}{}${"]".repeat(depth)}</script>`;
    assert.equal(
      extractJsonLdEvents(html, {
        formatKey: "community-arts-event-logistics",
        provenance,
      })[0]?.code,
      "traversal-limit-exceeded",
    );
  });

  it("requires a durable source identity and keeps it stable across graph reordering", () => {
    const identified = {
      "@type": "Event",
      "@id": "town-event-42",
      name: "Meeting",
      startDate: "2026-09-08T10:00:00-06:00",
      organizer: { name: "Town" },
      location: { name: "Hall" },
    };
    const context = { formatKey: "community-arts-event-logistics" as const, provenance };
    const first = extractJsonLdEvents(
      `<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "Thing" }, identified] })}</script>`,
      context,
    );
    const second = extractJsonLdEvents(
      `<script type="application/ld+json">${JSON.stringify({ "@graph": [identified, { "@type": "Thing" }] })}</script>`,
      context,
    );
    assert.equal(first[0]?.status, "parsed");
    assert.equal(second[0]?.status, "parsed");
    if (first[0]?.status === "parsed" && second[0]?.status === "parsed") {
      assert.equal(
        first[0].validation.valid && first[0].validation.notice.provenance.externalId,
        "town-event-42",
      );
      assert.equal(
        second[0].validation.valid && second[0].validation.notice.provenance.externalId,
        "town-event-42",
      );
    }

    const missing = { ...identified } as Record<string, unknown>;
    delete missing["@id"];
    assert.equal(
      extractJsonLdEvents(
        `<script type="application/ld+json">${JSON.stringify(missing)}</script>`,
        context,
      )[0]?.code,
      "missing-stable-identity",
    );
  });
});
