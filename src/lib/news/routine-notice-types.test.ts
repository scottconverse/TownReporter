import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateRoutineNotice, type RoutineNoticeInput } from "./routine-notice-types.ts";

const field = (value: string, locator: string) => ({ value, locator });
const provenance = {
  newsroomId: 41,
  sourceId: 7,
  sourceUrl: "https://civic.example/notices",
  policyRevision: 3,
  captureEventId: 11,
  artifactVersionId: 12,
  contentHash: "sha256:captured",
  externalId: "item-1",
};

const valid: RoutineNoticeInput[] = [
  {
    formatKey: "library-notice",
    variant: "program",
    provenance,
    fields: {
      issuer: field("North Library", "$.organizer.name"),
      program: field("Family story time", "$.name"),
      start: field("2026-11-01T10:00:00-07:00", "$.startDate"),
      location: field("Community room", "$.location.name"),
    },
  },
  {
    formatKey: "parks-recreation-notice",
    variant: "program",
    provenance: { ...provenance, externalId: "item-2" },
    fields: {
      issuer: field("City Recreation", "/issuer"),
      program: field("Youth swim", "/program"),
      start: field("2026-11-02", "/date"),
      location: field("West Pool", "/location"),
      registrationUrl: field("https://civic.example/register", "/registrationUrl"),
    },
  },
  {
    formatKey: "community-arts-event-logistics",
    variant: "event",
    provenance: { ...provenance, externalId: "item-3" },
    fields: {
      issuer: field("Town Arts Council", "$.organizer.name"),
      title: field("Autumn concert", "$.name"),
      start: field("2026-11-06T19:00:00-07:00", "$.startDate"),
      venue: field("Civic Hall", "$.location.name"),
    },
  },
  {
    formatKey: "registration-deadline",
    variant: "deadline",
    provenance: { ...provenance, externalId: "item-4" },
    fields: {
      issuer: field("Town Arts Council", "/issuer"),
      program: field("Winter classes", "/program"),
      deadline: field("2026-11-07T17:00:00-07:00", "/deadline"),
      registrationUrl: field("https://civic.example/classes", "/registrationUrl"),
    },
  },
  {
    formatKey: "waste-recycling-schedule",
    variant: "regular",
    provenance: { ...provenance, externalId: "item-5" },
    fields: {
      issuer: field("Town Sanitation", "/provider"),
      service: field("Recycling collection", "/service"),
      area: field("North district", "/area"),
      serviceDate: field("2026-11-09", "/serviceDate"),
    },
  },
  {
    formatKey: "public-meeting-logistics",
    variant: "meeting",
    provenance: { ...provenance, externalId: "item-6" },
    fields: {
      issuer: field("Town Council", "/body"),
      title: field("Regular meeting", "/title"),
      start: field("2026-11-10T18:00:00-07:00", "/start"),
      attendanceUrl: field("https://civic.example/meeting", "/attendanceUrl"),
      agendaUrl: field("https://civic.example/agenda", "/agendaUrl"),
    },
  },
];

describe("routine notice structural contracts", () => {
  it("normalizes and renders one structurally valid fixture for each approved family", () => {
    for (const input of valid) {
      const result = validateRoutineNotice(input);
      assert.equal(result.valid, true, input.formatKey);
      if (!result.valid) continue;
      assert.equal(result.notice.formatKey, input.formatKey);
      assert.equal(result.notice.provenance, input.provenance);
      assert.match(result.rendered, /Source: https:\/\/civic\.example\/notices/);
      assert.doesNotMatch(result.rendered, /undefined|null/i);
    }
  });

  it("withholds every family when a required structural field is absent", () => {
    for (const input of valid) {
      const fields = { ...input.fields } as Record<string, unknown>;
      delete fields.issuer;
      const result = validateRoutineNotice({ ...input, fields } as RoutineNoticeInput);
      assert.deepEqual(result, {
        valid: false,
        formatKey: input.formatKey,
        reasons: [{ code: "missing-required-field", field: "issuer" }],
      });
    }
  });

  it("supports non-event library and changed-schedule waste variants without inventing event fields", () => {
    const hours = validateRoutineNotice({
      formatKey: "library-notice",
      variant: "planned-hours",
      provenance,
      fields: {
        issuer: field("North Library", "/issuer"),
        branch: field("North branch", "/branch"),
        effectiveDate: field("2026-11-12", "/effectiveDate"),
        hours: field("10 a.m.–4 p.m.", "/hours"),
      },
    });
    assert.equal(hours.valid, true);
    if (hours.valid) {
      assert.match(hours.rendered, /Effective date: 2026-11-12/);
      assert.doesNotMatch(hours.rendered, /12:00|Program:|Start:/);
    }

    const changed = validateRoutineNotice({
      formatKey: "waste-recycling-schedule",
      variant: "changed",
      provenance,
      fields: {
        issuer: field("Town Sanitation", "/provider"),
        service: field("Trash collection", "/service"),
        area: field("South district", "/area"),
        serviceDate: field("2026-11-13", "/serviceDate"),
        scheduleChange: field("Moved from Thursday to Friday", "/change"),
      },
    });
    assert.equal(changed.valid, true);
    if (changed.valid) assert.match(changed.rendered, /Schedule change: Moved from Thursday/);
  });

  it("accepts explicit online participation instead of requiring a physical place", () => {
    const library = structuredClone(valid[0]);
    delete library.fields.location;
    library.fields.participationUrl = field("https://civic.example/story-time", "/join");
    assert.equal(validateRoutineNotice(library).valid, true);

    const event = structuredClone(valid[2]);
    delete event.fields.venue;
    event.fields.onlineUrl = field("https://civic.example/concert", "$.url");
    assert.equal(validateRoutineNotice(event).valid, true);
  });

  it("keeps optional facts unknown and rejects unsupported fields rather than interpreting prose", () => {
    const input = structuredClone(valid[2]) as RoutineNoticeInput & {
      fields: Record<string, unknown>;
    };
    input.fields.description = field("Free, probably cancelled if it rains", "$.description");
    const result = validateRoutineNotice(input);
    assert.deepEqual(result, {
      valid: false,
      formatKey: "community-arts-event-logistics",
      reasons: [{ code: "outside-routine-contract", field: "description" }],
    });

    const recurrence = structuredClone(valid[2]) as RoutineNoticeInput & {
      fields: Record<string, unknown>;
    };
    recurrence.fields.recurrence = field("FREQ=WEEKLY", "$.eventSchedule");
    assert.deepEqual(validateRoutineNotice(recurrence), {
      valid: false,
      formatKey: "community-arts-event-logistics",
      reasons: [{ code: "unsupported-recurrence", field: "recurrence" }],
    });

    const unknown = structuredClone(valid[2]) as RoutineNoticeInput & {
      fields: Record<string, unknown>;
    };
    unknown.fields.mystery = field("value", "$.mystery");
    assert.deepEqual(validateRoutineNotice(unknown), {
      valid: false,
      formatKey: "community-arts-event-logistics",
      reasons: [{ code: "unsupported-field", field: "mystery" }],
    });
  });

  it("preserves accepted raw values and locators without claiming provenance verification", () => {
    const result = validateRoutineNotice(valid[0]);
    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.deepEqual(result.notice.fields.start, valid[0].fields.start);
    assert.equal(result.notice.normalizedFields.start, valid[0].fields.start.value);
    assert.notEqual(result.notice.normalizedFields, result.notice.fields);
    assert.equal(result.notice.provenanceVerification, "unverified");
    assert.equal("eligible" in result, false);
    assert.equal("authoritative" in result, false);
  });

  it("rejects ambiguous local timestamps but preserves explicit date-only values", () => {
    const ambiguous = structuredClone(valid[0]);
    ambiguous.fields.start = field("2026-11-01T01:30:00", "$.startDate");
    assert.deepEqual(validateRoutineNotice(ambiguous), {
      valid: false,
      formatKey: "library-notice",
      reasons: [{ code: "ambiguous-timezone", field: "start" }],
    });

    const dateOnly = validateRoutineNotice(valid[1]);
    assert.equal(dateOnly.valid, true);
    if (dateOnly.valid) {
      assert.match(dateOnly.rendered, /Start: 2026-11-02/);
      assert.doesNotMatch(dateOnly.rendered, /T00:00|12:00/);
    }
  });

  it("rejects skipped and repeated zoned local times while accepting a unique one", () => {
    for (const start of ["2026-03-08T02:30:00", "2026-11-01T01:30:00"]) {
      const input = structuredClone(valid[0]);
      input.fields.start = field(start, "$.startDate");
      input.fields.timezone = field("America/Denver", "paper.timezone");
      assert.deepEqual(validateRoutineNotice(input), {
        valid: false,
        formatKey: "library-notice",
        reasons: [{ code: "ambiguous-timezone", field: "start" }],
      });
    }

    const unique = structuredClone(valid[0]);
    unique.fields.start = field("2026-03-08T03:30:00", "$.startDate");
    unique.fields.timezone = field("America/Denver", "paper.timezone");
    assert.equal(validateRoutineNotice(unique).valid, true);
  });

  it("requires structurally complete, but still unverified, provenance", () => {
    const input = structuredClone(valid[0]);
    input.provenance.sourceId = 0;
    assert.deepEqual(validateRoutineNotice(input), {
      valid: false,
      formatKey: "library-notice",
      reasons: [{ code: "invalid-field", field: "provenance.sourceId" }],
    });
  });

  it("builds stable fingerprint material independent of field insertion order", () => {
    const first = validateRoutineNotice(valid[0]);
    const reordered = structuredClone(valid[0]);
    reordered.fields = Object.fromEntries(
      Object.entries(reordered.fields).reverse(),
    ) as typeof reordered.fields;
    const second = validateRoutineNotice(reordered);
    assert.equal(first.valid, true);
    assert.equal(second.valid, true);
    if (first.valid && second.valid) {
      assert.equal(first.notice.fingerprintMaterial, second.notice.fingerprintMaterial);
      assert.equal(first.rendered, second.rendered);
      assert.equal(JSON.stringify(first.notice.fields), JSON.stringify(second.notice.fields));
    }
  });

  it("rejects impossible calendar values, unsupported local precision, and malformed runtime input", () => {
    for (const start of [
      "2026-02-30",
      "2026-13-01",
      "2026-02-30T10:00:00-07:00",
      "2026-11-01T25:00:00-07:00",
      "2026-11-01T10:00:00+15:00",
      "2026-11-01T10:00:00.5",
      "0096-02-30",
    ]) {
      const input = structuredClone(valid[0]);
      input.fields.start = field(start, "$.startDate");
      assert.deepEqual(validateRoutineNotice(input), {
        valid: false,
        formatKey: "library-notice",
        reasons: [{ code: "invalid-field", field: "start" }],
      });
    }
    assert.deepEqual(validateRoutineNotice(null), {
      valid: false,
      formatKey: null,
      reasons: [{ code: "invalid-field", field: "input" }],
    });
    assert.deepEqual(
      validateRoutineNotice({ formatKey: "library-notice", variant: "program", fields: null }),
      {
        valid: false,
        formatKey: "library-notice",
        reasons: [{ code: "invalid-field", field: "provenance.newsroomId" }],
      },
    );
  });

  it("enforces structural URL, boolean, status, and time-order fields", () => {
    const cases: Array<[RoutineNoticeInput, string]> = [];
    const url = structuredClone(valid[3]);
    url.fields.registrationUrl = field("javascript:alert(1)", "/registrationUrl");
    cases.push([url, "registrationUrl"]);

    const boolean = structuredClone(valid[1]);
    boolean.fields.registrationRequired = field("maybe", "/registrationRequired");
    cases.push([boolean, "registrationRequired"]);

    const status = structuredClone(valid[2]);
    status.fields.cancellation = field("not sure", "$.eventStatus");
    cases.push([status, "cancellation"]);

    const timezone = structuredClone(valid[0]);
    timezone.fields.timezone = field("Mars/Olympus", "paper.timezone");
    cases.push([timezone, "timezone"]);

    const reversed = structuredClone(valid[0]);
    reversed.fields.end = field("2026-11-01T09:00:00-07:00", "$.endDate");
    cases.push([reversed, "end"]);

    for (const [input, rejectedField] of cases) {
      assert.deepEqual(validateRoutineNotice(input), {
        valid: false,
        formatKey: input.formatKey,
        reasons: [{ code: "invalid-field", field: rejectedField }],
      });
    }

    const requiredLink = structuredClone(valid[1]);
    delete requiredLink.fields.registrationUrl;
    requiredLink.fields.registrationRequired = field("true", "/registrationRequired");
    assert.deepEqual(validateRoutineNotice(requiredLink), {
      valid: false,
      formatKey: "parks-recreation-notice",
      reasons: [{ code: "missing-required-field", field: "registrationUrl" }],
    });
  });

  it("accepts a unique local HH:mm value and renders its explicit timezone", () => {
    const input = structuredClone(valid[0]);
    input.fields.start = field("2026-09-08T10:00", "$.startDate");
    input.fields.timezone = field("America/Denver", "paper.timezone");
    const result = validateRoutineNotice(input);
    assert.equal(result.valid, true);
    if (result.valid) assert.match(result.rendered, /Timezone: America\/Denver/);
  });

  it("rejects an explicit offset that contradicts the source-asserted named timezone", () => {
    const input = structuredClone(valid[0]);
    input.fields.start = field("2026-07-01T10:00:00-07:00", "$.startDate");
    input.fields.timezone = field("America/Denver", "$.timezone");
    assert.deepEqual(validateRoutineNotice(input), {
      valid: false,
      formatKey: "library-notice",
      reasons: [{ code: "invalid-field", field: "start" }],
    });

    input.fields.start = field("2026-07-01T10:00:00-06:00", "$.startDate");
    assert.equal(validateRoutineNotice(input).valid, true);
  });
});
