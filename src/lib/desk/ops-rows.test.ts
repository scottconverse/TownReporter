// guards: Server health could claim an unloaded model is ready to write.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NOT_SET,
  clockText,
  clockTextAt,
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
  type OpsModelLine,
  type OpsRow,
} from "./ops-rows.ts";
import { OPS_CARDS, DRAWN_ROWS_WITHOUT_A_READ } from "./ops-cards.ts";
import { automaticLadder, providerEntry } from "../news/provider-registry.ts";
import type { HealthCheck } from "../ops/health.ts";
import type { ProviderStatus } from "../news/provider-login.ts";
import type { ProviderTimeSetting } from "../news/provider-settings.ts";
import type { LocalCatalog } from "../news/local-models.ts";

/*
  Unit CX2: the row a Server card prints, asserted against the read behind it.

  These are the values the audit could not check from a screenshot -- "1 · kept
  30 days" is a count of what is in the trash, and the only way to know the
  card is not printing a mock is to hand the builder a real shape and read the
  row back. Every fixture below is the real type; the ones worth naming are the
  ladder, which comes from the registry the runs read, and the one row that
  must say "Not set" on any machine (YouTube's "Transcripts" -- CX3 wired the
  other five that used to, and the cases here assert what they print now).
*/

const row = (rows: OpsRow[], label: string): OpsRow => {
  const found = rows.find((r) => r.label === label);
  assert.ok(found, `no row labelled ${label}`);
  return found;
};

const value = (rows: OpsRow[], label: string): string => row(rows, label).value;

/*
  The ladder's three reads, as fixtures. `timeRow` is the shipped settings shape
  with the three facts a chip reads hoisted to the front, so each case below
  names only the one it is about; `statusRow` is a login's answer the same way.
*/
const timeRow = (over: Partial<ProviderTimeSetting>): ProviderTimeSetting => ({
  providerId: "deepseek-flash",
  label: "DeepSeek v4.1 Flash",
  detail: "",
  kind: "local",
  callSeconds: 600,
  defaultCallSeconds: 600,
  overridden: false,
  enabled: true,
  availableOnThisMachine: true,
  endpoint: "http://127.0.0.1:11434/v1",
  endpointWatched: true,
  switchedOffByOperator: false,
  ...over,
});

const statusRow = (over: Partial<ProviderStatus>): ProviderStatus => ({
  provider: "codex",
  name: "Codex",
  installed: true,
  path: "/usr/local/bin/codex",
  signedIn: true,
  account: null,
  disabledByOperator: false,
  detail: "",
  lastChecked: "2026-09-28T00:00:00.000Z",
  lastTest: null,
  login: null,
  ...over,
});

const catalogOf = (
  servers: LocalCatalog["servers"],
  defaultModel: LocalCatalog["defaultModel"] = null,
): LocalCatalog => ({ servers, defaultModel, checkedAt: 0 });

/** The rung's readiness chip, or undefined -- the one thing these cases read. */
const chipOf = (lines: OpsModelLine[], name: string) => {
  const found = lines.find((line) => line.name === name);
  assert.ok(found, `no rung named ${name}`);
  return found.chip;
};

/** The words a chip carries, narrowed: the cases below all read a "words" chip. */
const wordsOf = (chip: OpsModelLine["chip"]) => {
  assert.equal(chip?.source, "words");
  return chip as { source: "words"; tone: string; label: string; help: string };
};

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
      The rows with no read behind them are the only rows in the product
      allowed to print "Not set". A row that acquires a real value and keeps
      the plain words would be worse than a missing read: it would look like an
      answer. The list is read from the module so this test cannot drift from
      the reasons recorded there.

      Five rows left this list in CX3 (0.6.81) because they had a source all
      along -- the backup's own state file, the failed-job window, the capture
      record's timestamp, the paper-wide override count, the live invite count
      -- and the cases below assert the values they now print. YouTube's
      "Transcripts" is the one that stayed, and the `why` there names the
      probe: the source does not exist, which is a different claim from "the
      row has no read here".
    */
    const bare = DRAWN_ROWS_WITHOUT_A_READ.map((entry) => `${entry.card}/${entry.row}`);
    assert.deepEqual(bare, ["youtube/Transcripts"]);
    for (const entry of DRAWN_ROWS_WITHOUT_A_READ) assert.ok(entry.why.length > 40, entry.row);
    /* And the one that stayed is a row the drawing really draws. */
    const card = OPS_CARDS.find((c) => c.key === "youtube");
    assert.ok(card?.rows.includes("Transcripts"));
  });

  it("Health: the drawn four rows, with the state in words and in tone", () => {
    const checks: HealthCheck[] = [
      { id: "db", label: "Database", state: "ok", value: "townreporter · 42 MB · answered in 3ms" },
      { id: "db-rows", label: "Contents", state: "ok", value: "1 published · 0 drafts" },
      { id: "disk", label: "Disk", state: "ok", value: "142.3 GB free of 476.8 GB" },
      { id: "jobs", label: "Work queue", state: "warn", value: "1 running" },
      { id: "backup", label: "Last backup", state: "ok", value: "4h ago", note: "3 local backups on disk" },
      {
        id: "errors-24h",
        label: "Errors in 24 h",
        state: "warn",
        value: "2",
        note: "Failed desk jobs in the last 24 hours. Open the work queue to see which.",
      },
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
    /* CX3: the last two rows print the checks behind them, not "Not set". */
    assert.equal(value(rows, "Last backup"), "4h ago");
    assert.equal(row(rows, "Last backup").tone, "plain", "a backup that succeeded is not a chip");
    assert.equal(row(rows, "Last backup").help, "3 local backups on disk");
    assert.equal(value(rows, "Errors in 24 h"), "2");
    assert.equal(row(rows, "Errors in 24 h").tone, "warn");
    assert.equal(row(rows, "Errors in 24 h").help, "Failed desk jobs in the last 24 hours. Open the work queue to see which.");
    /* The checks the drawing does not draw are not lost -- they are on the
       card's own screen -- but they are not rows here. */
    assert.equal(rows.length, 4);
  });

  it("Health: a backup and an error count that answered 'nothing yet' are not 'Not set'", () => {
    /*
      The bug CX3 fixes, in one case: a fresh desk's backup row must print what
      the desk knows -- that no backup is on record -- not the words for "no
      read here". Same for a day with nothing failing, which prints a real 0.
    */
    const rows = healthRows({
      checks: [
        { id: "db", label: "Database", state: "ok", value: "1 published" },
        {
          id: "backup",
          label: "Last backup",
          state: "unknown",
          value: "No backup on record",
          note: "The nightly backup writes logs\\backup-state.json the first time it runs (ops\\backup.ps1). Nothing has written it here.",
        },
        { id: "errors-24h", label: "Errors in 24 h", state: "ok", value: "0", note: "No desk job has failed in the last 24 hours." },
      ],
    });
    assert.equal(value(rows, "Last backup"), "No backup on record");
    assert.notEqual(value(rows, "Last backup"), NOT_SET);
    /* An unknown state is a sentence, not a chip: the drawing draws the row plain. */
    assert.equal(row(rows, "Last backup").tone, "plain");
    assert.match(row(rows, "Last backup").help ?? "", /ops\\backup\.ps1/);
    assert.equal(value(rows, "Errors in 24 h"), "0");
    assert.equal(row(rows, "Errors in 24 h").tone, "plain");
    /* A health read that carried neither check is the one case left that says
       "Not set", because it is a read with no reading rather than a desk with
       no fact. */
    const bare = healthRows({ checks: [{ id: "db", label: "Database", state: "ok", value: "x" }] });
    assert.equal(value(bare, "Last backup"), NOT_SET);
    assert.equal(value(bare, "Errors in 24 h"), NOT_SET);
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

  it("Paper setup on an install nobody has set up shows no Longmont and no address (F4)", () => {
    // The config an un-onboarded desk reads falls back to the shipped Longmont
    // constants and the build-time editor address; the card must not print them
    // as if they were this paper's own.
    const rows = paperSetupRows(
      {
        name: "TownReporter",
        city: "Longmont",
        state: "Colorado",
        editorEmail: "townreporterlongmont@gmail.com",
      } as never,
      { revision: 1, sections: [{ visible: true }, { visible: true }] } as never,
      true,
    );
    assert.equal(value(rows, "Name"), NOT_SET);
    assert.equal(value(rows, "Town"), NOT_SET);
    assert.equal(value(rows, "Editor email"), NOT_SET);
    assert.equal(value(rows, "Sections"), "2 visible");
    assert.doesNotMatch(JSON.stringify(rows), /Longmont|Colorado|townreporterlongmont/);
  });

  it("Paper setup on an onboarded paper (even with blank name, city, state: the live shape) is unchanged", () => {
    // needsSetup is false for an onboarded paper. Live's row is onboarded with
    // empty name/city/state, which merge with the shipped values: the card
    // reads exactly as it did before F4.
    const rows = paperSetupRows(
      {
        name: "TownReporter",
        city: "Longmont",
        state: "Colorado",
        editorEmail: "townreporterlongmont@gmail.com",
      } as never,
      { revision: 1, sections: [{ visible: true }] } as never,
      false,
    );
    assert.equal(value(rows, "Name"), "TownReporter");
    assert.equal(value(rows, "Town"), "Longmont, Colorado");
    assert.equal(value(rows, "Editor email"), "townreporterlongmont@gmail.com");
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
    assert.equal(value(dailyScanRows(base as never), "Fetch cap"), "12");
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

  it("clockTextAt reads a stored moment at the paper's own clock", () => {
    // 18:15 UTC is 12:15 p.m. in Denver -- the Pull row's "Tried 12:15 p.m.".
    assert.equal(
      clockTextAt("2026-10-02T18:15:00.000Z", "America/Denver"),
      "12:15 p.m.",
    );
    assert.equal(clockTextAt("2026-10-02T06:00:00.000Z", "America/Denver"), "12:00 a.m.");
    // The same instant, a different paper.
    assert.equal(clockTextAt("2026-10-02T18:15:00.000Z", "UTC"), "6:15 p.m.");
  });

  it("clockTextAt says nothing rather than inventing a time it cannot read", () => {
    assert.equal(clockTextAt(null, "America/Denver"), "");
    assert.equal(clockTextAt("not a date", "America/Denver"), "");
    assert.equal(clockTextAt("2026-10-02T18:15:00.000Z", "Not/AZone"), "");
  });

  it("Meeting capture: the watched bodies are the channels, and the capture time is the record's own", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    const rows = meetingCaptureRows(
      { channels: ["a", "b", "c"], lastCaptureAt: "2026-09-26T12:00:00.000Z" } as never,
      now,
    );
    assert.equal(value(rows, "Bodies watched"), "3");
    assert.equal(value(rows, "Last capture"), "2d ago");
    /* The hover carries the read's own timestamp, unrounded. */
    assert.equal(row(rows, "Last capture").help, "2026-09-26T12:00:00.000Z");
    /*
      A desk whose records carry no capture time has an ANSWER -- "None yet" --
      not a missing read, and not a time invented from the row's created_at
      (captured_at is nullable, migrations/0067).
    */
    const empty = meetingCaptureRows({ channels: [], lastCaptureAt: null } as never, now);
    assert.equal(value(empty, "Last capture"), "None yet");
    assert.equal(row(empty, "Last capture").help, undefined);
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
    assert.equal(value(namedOutletsRows({ stored: null, shipped, overrides: 0 } as never), "Outlets"), "2");
    assert.equal(
      value(namedOutletsRows({ stored: [{ name: "a" }] as never, shipped, overrides: 0 } as never), "Outlets"),
      "1",
    );
    assert.equal(value(namedOutletsRows({ stored: [], shipped, overrides: 0 } as never), "Outlets"), "0");
    /* CX3: the count is the paper's own override rows (append-only,
       migrations/0086), not either of the two per-draft reads in desk.ts. */
    assert.equal(value(namedOutletsRows({ stored: null, shipped, overrides: 2 } as never), "Overrides"), "2");
    assert.equal(value(namedOutletsRows({ stored: null, shipped, overrides: 0 } as never), "Overrides"), "0");
    assert.notEqual(value(namedOutletsRows({ stored: null, shipped, overrides: 0 } as never), "Overrides"), NOT_SET);
  });

  it("Editors & access: the owner is the account that holds the desk", () => {
    const rows = editorsAccessRows({ owner: { email: "owner@example.com", name: "Scott C." }, invitesOpen: 1 });
    assert.equal(value(rows, "Owner"), "owner@example.com");
    /* The name is the row's longer answer, not a second value. */
    assert.equal(row(rows, "Owner").help, "Scott C.");
    /* CX3: the live invite links, counted by the read. */
    assert.equal(value(rows, "Invites open"), "1");
  });

  it("Editors & access: a desk with no owner row says Not set rather than a blank", () => {
    const rows = editorsAccessRows({ owner: null, invitesOpen: 0 });
    assert.equal(value(rows, "Owner"), NOT_SET);
    assert.equal(row(rows, "Owner").help, undefined);
    /* "Not set" belongs to the owner row alone: no invites open is a real 0. */
    assert.equal(value(rows, "Invites open"), "0");
  });

  it("Editors & access: an account with no name still prints its address", () => {
    const rows = editorsAccessRows({ owner: { email: "  owner@example.com ", name: null }, invitesOpen: 3 });
    assert.equal(value(rows, "Owner"), "owner@example.com");
    assert.equal(row(rows, "Owner").help, undefined);
    assert.equal(value(rows, "Invites open"), "3");
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
    /* Called with no read this is the editor's ladder: a rung with no chip,
       not a rung with a "Not set" where the desk has an answer. */
    assert.ok(lines.every((line) => line.chip === undefined));
  });

  it("Writing models: a login rung wears the login's own chip, handed through untouched", () => {
    /*
      The whole point of `source: "status"`: the chip on this card and the chip
      on the Models screen are rendered by the same `WritingModelChip` from the
      same read, so they cannot say two different things. Identity is the
      assertion -- a copy would pass a value comparison and still drift.
    */
    const codex = statusRow({ provider: "codex", signedIn: false, detail: "codex is not signed in" });
    const claude = statusRow({ provider: "claude", name: "Claude Code" });
    const lines = writingModelLines({
      times: [timeRow({}), timeRow({ providerId: "qwen-local", label: "Local model" })],
      statuses: [codex, claude],
      catalog: catalogOf([]),
    });
    const onLadder = chipOf(lines, "Codex Terra");
    assert.equal(onLadder?.source, "status");
    assert.equal(onLadder?.source === "status" ? onLadder.status : null, codex);
    const byName = chipOf(lines, "Claude Opus");
    assert.equal(byName?.source === "status" ? byName.status : null, claude);
  });

  it("an answering server with only downloaded models is not ready to write", () => {
    const baseUrl = "http://127.0.0.1:1234/v1";
    const model = {
      id: "downloaded-model", label: "downloaded-model", loaded: false,
      kind: "chat" as const, thinking: false, vision: false, cloud: false, contextLength: null,
    };
    const chip = wordsOf(chipOf(writingModelLines({
      times: [timeRow({ providerId: "qwen-local", label: "Local model", endpoint: baseUrl })],
      statuses: [],
      catalog: catalogOf([{ kind: "lmstudio", baseUrl, reachable: true, models: [model] }], { baseUrl, id: model.id }),
    }), "Local model"));
    assert.notEqual(chip.tone, "ready");
  });

  it("Writing models: a local rung's chip is built from its own settings and the live catalog", () => {
    const server = { kind: "lmstudio" as const, baseUrl: "http://127.0.0.1:1234/v1", reachable: true, models: [] };
    const read = (over: {
      times?: Partial<ProviderTimeSetting>;
      catalog?: LocalCatalog;
      statuses?: ProviderStatus[];
    }) => ({
      times: [
        timeRow({}),
        timeRow({
          providerId: "qwen-local",
          label: "Local model",
          endpoint: "http://127.0.0.1:1234/v1",
          ...over.times,
        }),
      ],
      statuses: over.statuses ?? [],
      catalog: over.catalog ?? catalogOf([server]),
    });

    /* Switched off for the paper, then for the machine: the same two words a
       login gets, with the help sentence saying which of the two it was. */
    const paper = wordsOf(chipOf(writingModelLines(read({ times: { enabled: false } })), "Local model"));
    assert.equal(paper.label, "Turned off");
    assert.equal(paper.tone, "quiet");
    assert.match(paper.help, /this paper/);
    const machine = wordsOf(
      chipOf(writingModelLines(read({ times: { switchedOffByOperator: true } })), "Local model"),
    );
    assert.equal(machine.label, "Turned off");
    assert.match(machine.help, /this installation/);

    /* An address this installation named: the desk's look never visits it, so
       the chip says what it knows -- the address -- and not what it does not. */
    const byHand = wordsOf(
      chipOf(
        writingModelLines(read({ times: { endpoint: "http://10.0.0.5:9999/v1", endpointWatched: false } })),
        "Local model",
      ),
    );
    assert.equal(byHand.label, "Set by hand");
    assert.match(byHand.help, /http:\/\/10\.0\.0\.5:9999\/v1/);

    /* Watched, and nothing at the other end. */
    const silent = wordsOf(chipOf(writingModelLines(read({ catalog: catalogOf([]) })), "Local model"));
    assert.equal(silent.label, "Not answering");
    assert.equal(silent.tone, "quiet");

    /* Answering, but the rung needs a model in memory and none is loaded: the
       warn tone, and the same fact a run skips the rung on. */
    const empty = wordsOf(
      chipOf(
        writingModelLines(read({ catalog: catalogOf([server], { baseUrl: "http://127.0.0.1:11434/v1", id: "x" }) })),
        "Local model",
      ),
    );
    assert.equal(empty.label, "No model loaded");
    assert.equal(empty.tone, "slow");

    /* Answering with one loaded -- and the rung that needs nothing loaded is
       Ready on the same catalog, which is the difference the two help lines
       carry. */
    const withLoaded = (id: string): LocalCatalog =>
      catalogOf([
        {
          kind: "lmstudio",
          baseUrl: "http://127.0.0.1:1234/v1",
          reachable: true,
          models: [
            {
              id,
              label: id,
              loaded: true,
              kind: "chat",
              thinking: false,
              vision: false,
              cloud: false,
              contextLength: null,
            },
          ],
        },
      ]);
    const ready = wordsOf(
      chipOf(writingModelLines(read({ catalog: withLoaded("halo/qwen") })), "Local model"),
    );
    assert.equal(ready.label, "Ready");
    assert.equal(ready.tone, "ready");
    assert.match(ready.help, /with halo\/qwen loaded/);

    /*
      B4's regression, in this file. A server that is REACHABLE and whose disk
      is full of models -- a non-null `defaultModel`, exactly what `pickDefault`
      used to hand out -- but whose MEMORY is empty is NOT ready. Ready reads
      the catalog's own `loaded` flags now, not `defaultModel`.
    */
    const reachableNotLoaded = {
      kind: "lmstudio" as const,
      baseUrl: "http://127.0.0.1:1234/v1",
      reachable: true,
      models: [
        {
          id: "halo/qwen3-coder-30b-a3b-q6k",
          label: "halo/qwen3-coder-30b-a3b-q6k",
          loaded: false,
          kind: "chat" as const,
          thinking: false,
          vision: false,
          cloud: false,
          contextLength: null,
        },
      ],
    };
    const emptyMemory = wordsOf(
      chipOf(
        writingModelLines(
          read({
            catalog: catalogOf([reachableNotLoaded], {
              baseUrl: "http://127.0.0.1:1234/v1",
              id: "halo/qwen3-coder-30b-a3b-q6k",
            }),
          }),
        ),
        "Local model",
      ),
    );
    assert.equal(emptyMemory.label, "No model loaded");
    assert.equal(emptyMemory.tone, "slow");
    assert.match(emptyMemory.help, /no chat model is loaded in memory/);
    const first = wordsOf(
      chipOf(
        writingModelLines(
          read({ catalog: catalogOf([server], { baseUrl: "http://127.0.0.1:1234/v1", id: "halo/qwen" }) }),
        ),
        "DeepSeek v4.1 Flash",
      ),
    );
    assert.equal(first.label, "Not answering");
    assert.match(first.help, /Nothing answered at http:\/\/127\.0\.0\.1:11434\/v1/);
  });

  it("Writing models: a rung no read covers draws no chip rather than an invented one", () => {
    const lines = writingModelLines({
      times: [],
      statuses: [],
      catalog: catalogOf([]),
    });
    assert.ok(lines.every((line) => line.chip === undefined));
  });
});
