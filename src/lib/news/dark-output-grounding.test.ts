import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groundedDarkWindow, isGroundedDarkPromise, preserveBoundedAbsenceLanguage } from "./dark.ts";

describe("Dark Desk model-output grounding", () => {
  it("uses the saved run window rather than a model-invented date", () => {
    assert.equal(groundedDarkWindow(), "unknown");
    assert.equal(
      groundedDarkWindow({
        mode: "range",
        lookbackDays: 90,
        startDate: "2026-08-01",
        endDate: "2026-09-15",
        verificationLimit: 6,
        capturedAt: "2026-09-15T12:00:00.000Z",
      }),
      "2026-08-01 through 2026-09-15 (search preference; verify dates in each source)",
    );
  });

  it("rejects an invented promise even when the named actor is in the pack", () => {
    const pack = "CAPTURED FESTIVAL PAGE: Pizza With Purpose organized the event. No reporting commitment is stated.";
    assert.equal(
      isGroundedDarkPromise(
        {
          who: "Pizza With Purpose",
          what: "Publish a financial report",
          when_due: "after the event",
          source_cite: "CAPTURED FESTIVAL PAGE",
          status: "open",
        },
        pack,
      ),
      false,
    );
  });

  it("accepts a sourced explicit commitment", () => {
    const pack = "JULY 14 COUNCIL MINUTES: Public Works will file the Group 2 construction notice by 2026-10-01.";
    assert.equal(
      isGroundedDarkPromise(
        {
          who: "Public Works",
          what: "File the Group 2 construction notice",
          when_due: "2026-10-01",
          source_cite: "JULY 14 COUNCIL MINUTES",
          status: "open",
        },
        pack,
      ),
      true,
    );
  });

  it("rejects a fabricated locator even if commitment words appear", () => {
    const pack = "Public Works will file the notice. CAPTURE 17 contains the statement.";
    assert.equal(
      isGroundedDarkPromise(
        {
          who: "Public Works",
          what: "File the notice",
          source_cite: "CAPTURE 99",
        },
        pack,
      ),
      false,
    );
  });

  it("rejects an invented action attached to a real actor and source", () => {
    const pack = "CAPTURED MINUTES: Public Works will file a construction notice.";
    assert.equal(
      isGroundedDarkPromise(
        {
          who: "Public Works",
          what: "Transfer $9 million to a private account",
          source_cite: "CAPTURED MINUTES",
        },
        pack,
      ),
      false,
    );
  });

  it("keeps a bounded record search from becoming a universal absence claim", () => {
    const pack = "No SOS registration was established in the captured material. The absence of those records does not prove they do not exist.";
    assert.equal(
      preserveBoundedAbsenceLanguage(
        "No SOS registration was found. No city permit was found in the current file.",
        pack,
      ),
      "The bounded evidence pack did not establish SOS registration. The bounded evidence pack did not establish city permit.",
    );
  });

  it("does not rewrite an absence supported by an unbounded evidence pack", () => {
    assert.equal(
      preserveBoundedAbsenceLanguage("No agenda was found.", "The complete authoritative inventory for 2026 is attached."),
      "No agenda was found.",
    );
  });

  it("recognizes a standalone bounded not-established statement", () => {
    assert.equal(
      preserveBoundedAbsenceLanguage(
        "No SOS registration was found.",
        "No SOS registration was established in the captured material.",
      ),
      "The bounded evidence pack did not establish SOS registration.",
    );
  });

  it("narrows direct nonexistence, registration, permit and missing claims", () => {
    const pack = "No entity or permit was established in the captured material.";
    assert.equal(
      preserveBoundedAbsenceLanguage(
        "The organization does not exist. Pizza With Purpose is unregistered. The festival is unpermitted. The fiscal sponsor is missing.",
        pack,
      ),
      "The bounded evidence pack did not establish the existence of the organization. The bounded evidence pack did not establish registration for Pizza With Purpose. The bounded evidence pack did not establish permits for the festival. The bounded evidence pack did not establish the presence of the fiscal sponsor.",
    );
  });
});
