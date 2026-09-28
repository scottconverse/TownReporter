import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NOT_SET,
  clockText,
  dailyScanRows,
  editorsAccessRows,
  healthRows,
  meetingCaptureRows,
  namedOutletsRows,
  paperSetupRows,
  perCallText,
  recentlyDeletedRows,
  routineNoticeRows,
  secondsText,
  sectionsRows,
  timeBudgetRows,
  writingModelLines,
  youtubeRows,
  type OpsRow,
} from "./ops-rows.ts";
import { OPS_CARDS, DRAWN_ROWS_WITHOUT_A_READ } from "./ops-cards.ts";
import { automaticLadder, providerEntry } from "../news/provider-registry.ts";
import type { HealthCheck } from "../ops/health.ts";

/*
  Unit CX2: the row a Server card prints, asserted against the read behind it.

  These are the values the audit could not check from a screenshot -- "1 · kept
  30 days" is a count of what is in the trash, and the only way to know the
  card is not printing a mock is to hand the builder a real shape and read the
  row back. Every fixture below is the real type; the ones worth naming are the
  ladder, which comes from the registry the runs read, and the six rows that
  must say "Not set" on any machine.
*/

const row = (rows: OpsRow[], label: string): OpsRow => {
  const found = rows.find((r) => r.label === label);
  assert.ok(found, `no row labelled ${label}`);
  return found;
};

const value = (rows: OpsRow[], label: string): string => row(rows, label).value;

describe("Server card rows (CX2)", () => {
  it("draws the twelve cards the drawing draws, in its order", () => {
    assert.deepEqual(
      OPS_CARDS.map((card) => card.title),
      [
        "Writing models",
        "Health",
        "Paper setup",
        "Recently deleted",
        "Sections",
        "Daily scan",
        "Meeting capture",
        "YouTube",
        "Routine notices",
        "Named outlets",
        "Editors & access",
        "Time budgets",
      ],
    );
  });

  it("fills every drawn row from a real read, and says Not set only where there is none", () => {
    /*
      The six rows with no read behind them are the only rows in the product
      allowed to print "Not set". A row that acquires a real value and keeps
      the plain words would be worse than a missing read: it would look like an
      answer. The list is read from the module so this test cannot drift from
      the reasons recorded there.
    */
    const bare = DRAWN_ROWS_WITHOUT_A_READ.map((entry) => `${entry.card}/${entry.row}`);
    assert.deepEqual(bare, [
      "health/Last backup",
      "health/Errors in 24 h",
      "youtube/Transcripts",
      "meeting-capture/Last capture",
      "named-outlets/Overrides",
      "editors-access/Invites open",
    ]);
    for (const entry of DRAWN_ROWS_WITHOUT_A_READ) assert.ok(entry.why.length > 40, entry.row);
  });

  it("Health: the drawn four rows, with the state in words and in tone", () => {
    const checks: HealthCheck[] = [
      { id: "db", label: "Database", state: "ok", value: "townreporter · 42 MB · answered in 3ms" },
      { id: "db-rows", label: "Contents", state: "ok", value: "1 published · 0 drafts" },
      { id: "disk", label: "Disk", state: "ok", value: "142.3 GB free of 476.8 GB" },
      { id: "jobs", label: "Work queue", state: "warn", value: "1 running" },
    ];
    const rows = healthRows({ checks });
    assert.deepEqual(
      rows.map((r) => r.label),
      ["Database", "Disk", "Last backup", "Errors in 24 h"],
    );
    assert.equal(value(rows, "Database"), "OK");
    assert.equal(row(rows, "Database").tone, "ok");
    assert.equal(row(rows, "Database").help, "townreporter · 42 MB · answered in 3ms");
    assert.equal(value(rows, "Disk"), "142.3 GB free of 476.8 GB");
    /* The drawing draws Disk plain; a healthy row does not shout. */
    assert.equal(row(rows, "Disk").tone, "plain");
    assert.equal(value(rows, "Last backup"), NOT_SET);
    assert.equal(value(rows, "Errors in 24 h"), NOT_SET);
    /* The checks the drawing does not draw are not lost -- they are on the
       card's own screen -- but they are not rows here. */
    assert.equal(rows.length, 4);
  });

  it("Health: a down database and a full disk say so in words and tone", () => {
    const rows = healthRows({
      checks: [
        { id: "db", label: "Database", state: "down", value: "not answering" },
        { id: "disk", label: "Disk", state: "warn", value: "900 MB free of 476.8 GB" },
      ],
    });
    assert.equal(value(rows, "Database"), "Down");
    assert.equal(row(rows, "Database").tone, "fail");
    assert.equal(row(rows, "Disk").tone, "warn");
  });

  it("Paper setup: the paper's own name, town and editor", () => {
    const rows = paperSetupRows(
      {
        name: "TownReporter",
        city: "Longmont",
        state: "Colorado",
        editorEmail: "townreporter@gmail.com",
      } as never,
      { revision: 1, sections: [{ visible: true }, { visible: true }, { visible: false }] } as never,
    );
    assert.equal(value(rows, "Name"), "TownReporter");
    assert.equal(value(rows, "Town"), "Longmont, Colorado");
    assert.equal(value(rows, "Editor email"), "townreporter@gmail.com");
    assert.equal(value(rows, "Sections"), "2 visible");
  });

  it("Paper setup: a paper with no editor email says Not set, not a blank", () => {
    const rows = paperSetupRows(
      { name: "  ", city: "", state: "", editorEmail: null } as never,
      { revision: 0, sections: [] } as never,
    );
    assert.equal(value(rows, "Name"), NOT_SET);
    assert.equal(value(rows, "Town"), NOT_SET);
    assert.equal(value(rows, "Editor email"), NOT_SET);
    assert.equal(value(rows, "Sections"), "0 visible");
  });

  it("Recently deleted: the count is the trash's own rows", () => {
    const rows = recentlyDeletedRows([
      { kind: "draft" } as never,
      { kind: "lead" } as never,
      { kind: "article" } as never,
    ]);
    assert.equal(value(rows, "Drafts"), "1 · kept 30 days");
    assert.equal(value(rows, "Killed leads"), "Stay on the desk under Killed");
  });

  it("Sections: visible and put away add up to the sections there are", () => {
    const rows = sectionsRows({
      revision: 2,
      sections: [{ visible: true }, { visible: false }, { visible: false }] as never,
    });
    assert.equal(value(rows, "Visible"), "1");
    assert.equal(value(rows, "Hidden or retired"), "2");
  });

  it("Daily scan: the stored time in the drawing's words", () => {
    const base = { localTime: "06:00", sourceCap: 12, paused: false, enabled: true };
    assert.equal(value(dailyScanRows(base as never), "Runs"), "6:00 a.m. daily");
    assert.equal(value(dailyScanRows(base as never), "Files up to"), "12 leads");
    assert.equal(value(dailyScanRows({ ...base, localTime: "18:05" } as never), "Runs"), "6:05 p.m. daily");
    assert.equal(value(dailyScanRows({ ...base, localTime: "00:30" } as never), "Runs"), "12:30 a.m. daily");
    assert.equal(value(dailyScanRows({ ...base, enabled: false } as never), "Runs"), "Off");
    assert.equal(value(dailyScanRows({ ...base, paused: true } as never), "Runs"), "Paused");
  });

  it("clockText passes a time it cannot read through rather than inventing one", () => {
    assert.equal(clockText("06:00"), "6:00 a.m.");
    assert.equal(clockText("12:00"), "12:00 p.m.");
    assert.equal(clockText("not a time"), "not a time");
    assert.equal(clockText("  "), NOT_SET);
  });

  it("Meeting capture: the watched bodies are the channels on the settings", () => {
    const rows = meetingCaptureRows({ channels: ["a", "b", "c"] } as never);
    assert.equal(value(rows, "Bodies watched"), "3");
    assert.equal(value(rows, "Last capture"), NOT_SET);
  });

  it("YouTube: the key row prints the desk's own sentence for the key's state", () => {
    const rows = youtubeRows({
      hasKey: true,
      source: "stored",
      wording: "A key is saved.",
      unitsToday: 0,
      unitsLimit: 10000,
      quotaBlockedToday: false,
    } as never);
    assert.equal(value(rows, "API key"), "A key is saved.");
    assert.equal(row(rows, "API key").tone, "ok");
    assert.equal(value(rows, "Transcripts"), NOT_SET);
  });

  it("Routine notices: only approvals that are valid and still accepted count", () => {
    const policy = {
      paused: false,
      approvals: [
        { formatKey: "library-notice", sourceState: "accepted", valid: true },
        { formatKey: "library-notice", sourceState: "accepted", valid: true },
        { formatKey: "parks-recreation-notice", sourceState: "accepted", valid: true },
        { formatKey: "registration-deadline", sourceState: "changed", valid: true },
        { formatKey: "waste-recycling-schedule", sourceState: "accepted", valid: false },
      ],
    };
    const automation = {
      enabled: true,
      localTime: "06:15",
      recentRuns: [{ createdAt: "2026-09-23T12:04:00.000Z", localDate: "2026-09-23", status: "completed" }],
    };
    const rows = routineNoticeRows(policy as never, automation as never);
    /* Two distinct kinds, not five approvals. */
    assert.equal(value(rows, "Handled automatically"), "2 kinds");
    assert.equal(value(rows, "Last run"), "2026-09-23T12:04:00.000Z");
    assert.equal(row(rows, "Last run").help, "2026-09-23 · completed");
  });

  it("Routine notices: a desk that has never run says so", () => {
    const rows = routineNoticeRows(
      { paused: false, approvals: [] } as never,
      { enabled: false, localTime: "06:15", recentRuns: [] } as never,
    );
    assert.equal(value(rows, "Handled automatically"), "0 kinds");
    assert.equal(value(rows, "Last run"), "Not run yet");
  });

  it("Named outlets: the stored list wins, and an empty stored list means none", () => {
    const shipped = [{ name: "a" }, { name: "b" }] as never;
    assert.equal(value(namedOutletsRows({ stored: null, shipped } as never), "Outlets"), "2");
    assert.equal(value(namedOutletsRows({ stored: [{ name: "a" }] as never, shipped } as never), "Outlets"), "1");
    assert.equal(value(namedOutletsRows({ stored: [], shipped } as never), "Outlets"), "0");
    assert.equal(value(namedOutletsRows({ stored: null, shipped } as never), "Overrides"), NOT_SET);
  });

  it("Editors & access: the owner is the account that holds the desk", () => {
    const rows = editorsAccessRows({ owner: { email: "owner@example.com", name: "Scott C." } });
    assert.equal(value(rows, "Owner"), "owner@example.com");
    /* The name is the row's longer answer, not a second value. */
    assert.equal(row(rows, "Owner").help, "Scott C.");
    assert.equal(value(rows, "Invites open"), NOT_SET);
  });

  it("Editors & access: a desk with no owner row says Not set rather than a blank", () => {
    const rows = editorsAccessRows({ owner: null });
    assert.equal(value(rows, "Owner"), NOT_SET);
    assert.equal(row(rows, "Owner").help, undefined);
  });

  it("Editors & access: an account with no name still prints its address", () => {
    const rows = editorsAccessRows({ owner: { email: "  owner@example.com ", name: null } });
    assert.equal(value(rows, "Owner"), "owner@example.com");
    assert.equal(row(rows, "Owner").help, undefined);
  });

  it("secondsText and perCallText: the drawing's two shapes, and a range when they differ", () => {
    assert.equal(secondsText(600), "10 min");
    assert.equal(secondsText(45), "45 s");
    assert.equal(secondsText(1500), "25 min");
    assert.equal(secondsText(750), "12 min 30 s");
    assert.equal(secondsText(150), "2 min 30 s");
    assert.equal(perCallText([600, 600]), "10 min per call");
    assert.equal(perCallText([45]), "45 s per call");
    assert.equal(perCallText([150, 600]), "2 min 30 s–10 min per call");
    assert.equal(perCallText([]), NOT_SET);
  });

  it("Time budgets: the two drawn groups split the providers that exist", () => {
    const rows = timeBudgetRows([
      { providerId: "deepseek-flash", kind: "local", callSeconds: 600 },
      { providerId: "configured", kind: "openai", callSeconds: 600 },
      { providerId: "codex-balanced", kind: "codex", callSeconds: 150 },
      { providerId: "claude-sonnet", kind: "claude-code", callSeconds: 150 },
    ] as never);
    assert.equal(value(rows, "Local models"), "10 min per call");
    assert.equal(value(rows, "Subscription CLIs"), "2 min 30 s per call");
  });

  it("Time budgets: a machine with nothing to group says Not set in that group only", () => {
    const rows = timeBudgetRows([{ providerId: "codex-balanced", kind: "codex", callSeconds: 150 }] as never);
    assert.equal(value(rows, "Local models"), NOT_SET);
    assert.equal(value(rows, "Subscription CLIs"), "2 min 30 s per call");
  });

  it("Writing models: the ladder is the registry's own, in the order the runs try it", () => {
    const lines = writingModelLines();
    const ladder = automaticLadder();
    assert.equal(lines.length, ladder.length + 1);
    assert.deepEqual(
      lines.slice(0, ladder.length).map((line) => line.n),
      ladder.map((id) => String(providerEntry(id)!.ladderRank)),
    );
    assert.deepEqual(
      lines.slice(0, ladder.length).map((line) => line.name),
      ladder.map((id) => providerEntry(id)!.label),
    );
    const byName = lines[lines.length - 1];
    assert.equal(byName.n, "—");
    assert.equal(byName.name, providerEntry("claude-frontier")!.label);
    assert.equal(byName.note, "Only when you choose it by name");
    /* The unnumbered row is not on the ladder: that is what makes it by-name. */
    assert.ok(!ladder.includes("claude-frontier"));
  });
});
