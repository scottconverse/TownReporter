import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_METHOD_LABELS,
  FOLLOW_UP_FILTERS,
  FOLLOW_UP_FILTER_LABELS,
  cardActions,
  cardChip,
  cardResultLine,
  cardTimeLine,
  clockLabel,
  followUpCardState,
  followUpFilterLabel,
  followUpStoppedNotice,
  followUpTargets,
  findingNoteLine,
  isAgentKind,
  isFollowUpSchedule,
  matchesFollowUpFilter,
  methodLine,
  nextCheckLabel,
  nextRunAt,
  packFinding,
  parseFinding,
  RUN_HEARTBEAT_STALE_MS,
  scheduleForAgent,
  watchNotice,
  type FollowUpCardState,
} from "./follow-up-copy.ts";
import type { FollowUpRow } from "./types.ts";

/*
  The Follow-ups screen's vocabulary, tested without rendering anything: which
  card state a row is DRAWN in, what its chip and its two sentences say, which
  buttons it offers, and which of the four filters it belongs to. The screen and
  the card component are thin over these functions on purpose, so that "a
  stopped agent whose last run found something is a stopped card" is a sentence
  a test can assert rather than a branch buried in JSX.
*/

function row(over: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id: 1,
    newsroom_id: 1,
    user_id: "editor",
    lead_id: null,
    article_id: null,
    who: "Re-check pages",
    what: "Whether the Oct. 8 meeting was cancelled",
    due_on: null,
    status: "active",
    nudged_at: null,
    answered_at: null,
    reply_text: null,
    created_at: "2026-09-01T00:00:00.000Z",
    agent_kind: "recheck",
    targets_json: "[]",
    schedule: "2h",
    model_choice: "auto",
    last_run_at: null,
    next_run_at: null,
    last_state: null,
    finding_json: "{}",
    ...over,
  };
}

/** A local wall-clock instant, so the assertions do not depend on a timezone. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe("what an agent can be told to do", () => {
  it("maps the three drawn methods to their cadence", () => {
    assert.equal(scheduleForAgent("recheck"), "2h");
    assert.equal(scheduleForAgent("search"), "daily");
    assert.equal(scheduleForAgent("agenda"), "posting-days");
  });

  it("accepts the three agent kinds and refuses a fourth", () => {
    for (const kind of ["recheck", "search", "agenda"]) assert.equal(isAgentKind(kind), true);
    assert.equal(isAgentKind("watch"), false);
    assert.equal(isAgentKind(null), false);
    assert.equal(isAgentKind(""), false);
  });

  it("accepts the six schedules and refuses an unknown one", () => {
    for (const schedule of ["2h", "6h", "12h", "daily", "weekly", "posting-days"]) {
      assert.equal(isFollowUpSchedule(schedule), true);
    }
    assert.equal(isFollowUpSchedule("hourly"), false);
    assert.equal(isFollowUpSchedule(""), false);
  });

  it("writes the card's method line from the kind and the schedule", () => {
    assert.equal(methodLine("recheck", "2h"), "Re-check pages · every 2 hours");
    assert.equal(methodLine("search", "daily"), "Search public records · daily");
    assert.equal(methodLine("agenda", "posting-days"), "Watch for next agenda · Tue & Fri");
  });

  it("says a schedule it does not know out loud rather than inventing a cadence", () => {
    assert.equal(methodLine("recheck", "whenever"), "Re-check pages · whenever");
    assert.equal(methodLine("recheck", ""), "Re-check pages · no schedule");
  });

  it("names every agent kind in the method table", () => {
    for (const kind of ["recheck", "search", "agenda"] as const) {
      assert.ok(AGENT_METHOD_LABELS[kind].length > 0);
    }
  });
});

describe("when the next check is due", () => {
  it("adds the interval for a fixed schedule", () => {
    const from = at(2026, 9, 26, 9, 0);
    assert.equal(nextRunAt("2h", from)?.getHours(), 11);
    assert.equal(nextRunAt("6h", from)?.getHours(), 15);
    assert.equal(nextRunAt("daily", from)?.getDate(), 27);
    assert.equal(nextRunAt("weekly", from)?.getDate(), 3);
  });

  it("has no next run at all for a schedule it does not know", () => {
    // Safer than a default: an agent that stops is visible, one that runs on
    // every tick looks busy while spending the model budget.
    assert.equal(nextRunAt("hourly", at(2026, 9, 26, 9, 0)), null);
    assert.equal(nextRunAt("", at(2026, 9, 26, 9, 0)), null);
  });

  it("puts the agenda agent on the next posting day at 06:00, strictly after now", () => {
    // 2026-09-26 is a Saturday; the next posting day is Tuesday the 29th.
    const next = nextRunAt("posting-days", at(2026, 9, 26, 9, 0));
    assert.ok(next);
    assert.equal(next.getDay(), 2);
    assert.equal(next.getDate(), 29);
    assert.equal(next.getHours(), 6);
    assert.equal(next.getMinutes(), 0);
  });

  it("rolls a posting day forward once that morning has passed", () => {
    // Tuesday the 29th at 06:00 has just gone; Friday the 2nd is next.
    const next = nextRunAt("posting-days", at(2026, 9, 29, 6, 1));
    assert.ok(next);
    assert.equal(next.getDay(), 5);
    assert.equal(next.getDate(), 2);
  });
});

describe("the finding", () => {
  it("reads an empty or damaged value as an empty finding, never as a throw", () => {
    for (const raw of [null, undefined, "", "not json", "[]", '"a string"', "null"]) {
      assert.deepEqual(parseFinding(raw), parseFinding("{}"));
    }
  });

  it("round-trips a written finding", () => {
    const found = {
      title: "Meeting cancelled",
      summary: "The Oct. 8 meeting was cancelled.",
      url: "https://clerk.test/minutes",
      reason: "",
      checkedAt: "2026-09-26T13:48:00.000Z",
      changed: true,
    };
    assert.deepEqual(parseFinding(packFinding(found)), found);
  });

  it("truncates a field rather than carrying an unbounded string to the screen", () => {
    const long = parseFinding(JSON.stringify({ title: "x".repeat(500), summary: "y".repeat(900) }));
    assert.equal(long.title.length, 200);
    assert.equal(long.summary.length, 600);
  });

  it("puts the finding into one line for the story's notes, with its link", () => {
    const line = parseFinding(
      packFinding({ title: "Meeting cancelled", summary: "It was called off.", url: "https://x.test/a" }),
    );
    assert.equal(findingNoteLine(line), "Meeting cancelled — It was called off. (https://x.test/a)");
    // A finding with no title still says something a person reading the notes
    // can act on, rather than starting with a dash.
    assert.equal(
      findingNoteLine(parseFinding(packFinding({ summary: "The page changed." }))),
      "AI follow-up — The page changed.",
    );
    assert.equal(findingNoteLine(parseFinding("{}")), "AI follow-up");
    assert.ok(findingNoteLine(parseFinding(packFinding({ summary: "y".repeat(900) }))).length <= 500);
  });

  it("reads targets_json as the list of links it is, and gives [] for anything else", () => {
    assert.deepEqual(followUpTargets('["https://a.test","https://b.test"]'), [
      "https://a.test",
      "https://b.test",
    ]);
    assert.deepEqual(followUpTargets('["https://a.test",3,null]'), ["https://a.test"]);
    assert.deepEqual(followUpTargets("{}"), []);
    assert.deepEqual(followUpTargets("broken"), []);
    assert.deepEqual(followUpTargets(null), []);
  });
});

describe("which card a row is drawn as", () => {
  it("draws a row with no agent kind as a manual ask, in no agent state", () => {
    assert.equal(followUpCardState(row({ agent_kind: null, status: "open" })), "manual");
    assert.equal(cardChip("manual"), null);
    assert.deepEqual(cardActions("manual", false), []);
  });

  it("lets a terminal status win over the last run's outcome", () => {
    // The editor ended it. Offering "Pause" beside a found result would be
    // offering a button that does nothing.
    assert.equal(followUpCardState(row({ status: "stopped", last_state: "found" })), "stopped");
    assert.equal(followUpCardState(row({ status: "done", last_state: "found" })), "done");
  });

  it("says Stopping… while the stopped row's run is still finishing, then Stopped", () => {
    const stopped = row({ status: "stopped", last_state: "found" });
    // The one state the row cannot answer alone: Stop has committed, so no
    // further run will ever be picked -- but the run it had in flight has not
    // reached its terminal state, and the card must not claim otherwise while a
    // progress bar underneath it is still moving.
    assert.equal(followUpCardState(stopped, { status: "running" }), "stopping");
    // The moment the job is terminal, the card is the stopped one -- and a
    // stopped follow-up with no run at all was never stopping in the first
    // place, which is every card that was stopped while idle.
    assert.equal(followUpCardState(stopped, { status: "failed" }), "stopped");
    assert.equal(followUpCardState(stopped, { status: "completed" }), "stopped");
    assert.equal(followUpCardState(stopped, null), "stopped");
    assert.equal(followUpCardState(stopped), "stopped");
    // Nothing else is affected by a live run.
    assert.equal(followUpCardState(row({ last_state: "running" }), { status: "running" }), "running");
  });

  it("does not call a dead worker's run 'Stopping…', and offers Resume again", () => {
    /*
      The two ways the chip used to stick, both of which leave the editor with a
      card that offers nothing:
       - the worker died (or the machine did), so the row says `running` and
         will never move again on its own;
       - the run is still `queued` behind a long draft, so nothing has started
         and nothing is stopping.
      Both are "Stopped" -- the follow-up IS stopped -- and a stopped card is
      the one with Resume on it.
    */
    const stopped = row({ status: "stopped", last_state: "waiting" });
    const now = at(2026, 9, 30, 12, 0);
    const seconds = (n: number) => new Date(now.getTime() - n * 1000).getTime();

    // A live worker: the last heartbeat is well inside the window.
    assert.equal(followUpCardState(stopped, { status: "running", updatedAt: seconds(5) }, now), "stopping");
    assert.equal(
      followUpCardState(stopped, { status: "running", updatedAt: seconds(RUN_HEARTBEAT_STALE_MS / 1000) }, now),
      "stopping",
      "the boundary itself is still alive -- the rule is 'older than', not 'as old as'",
    );
    // And past it, not.
    assert.equal(
      followUpCardState(stopped, { status: "running", updatedAt: seconds(RUN_HEARTBEAT_STALE_MS / 1000 + 1) }, now),
      "stopped",
    );
    // A run that has not started is not a run that is stopping.
    assert.equal(followUpCardState(stopped, { status: "queued", updatedAt: seconds(600) }, now), "stopped");
    // No heartbeat at all is no evidence either way, so the run counts as live --
    // the same answer `jobHeartbeatStale` gives for a row with no timestamp.
    assert.equal(followUpCardState(stopped, { status: "running", updatedAt: null }, now), "stopping");
    // The Resume button is what a Stopped card has, so the dead-worker card is
    // a card the editor can act on.
    assert.deepEqual(
      cardActions(followUpCardState(stopped, { status: "running", updatedAt: seconds(600) }, now), false).map(
        (action) => action.key,
      ),
      ["resume", "edit"],
    );
  });

  it("reads a row that has never run as the waiting card", () => {
    assert.equal(followUpCardState(row({ last_state: null })), "waiting");
    assert.equal(followUpCardState(row({ last_state: "waiting" })), "waiting");
  });

  it("carries each last_state through to its own card", () => {
    const states: [string, FollowUpCardState][] = [
      ["running", "running"],
      ["found", "found"],
      ["no-change", "no-change"],
      ["could-not-check", "could-not-check"],
    ];
    for (const [last, expected] of states) {
      assert.equal(followUpCardState(row({ last_state: last as FollowUpRow["last_state"] })), expected);
    }
  });
});

describe("the chip, the sentences and the buttons", () => {
  it("gives every drawn state a chip, and stops and finishes the neutral tone", () => {
    assert.deepEqual(cardChip("found"), { text: "Found an answer", tone: "found" });
    assert.deepEqual(cardChip("running"), { text: "Running now", tone: "run" });
    assert.deepEqual(cardChip("waiting"), { text: "Waiting", tone: "wait" });
    assert.deepEqual(cardChip("no-change"), { text: "Checked · no change", tone: "none" });
    assert.deepEqual(cardChip("could-not-check"), { text: "Could not check", tone: "fail" });
    assert.deepEqual(cardChip("stopped"), { text: "Stopped", tone: "wait" });
    assert.deepEqual(cardChip("done"), { text: "Finished", tone: "wait" });
    // The run really is still going, so the chip wears the running tone rather
    // than the neutral one it changes into.
    assert.deepEqual(cardChip("stopping"), { text: "Stopping…", tone: "run" });
  });

  it("draws the same card as Stopping… and then as Stopped", () => {
    // The whole of the UI requirement, as one press and one poll: the editor
    // stops a card whose run is in flight, and the card changes when -- and
    // only when -- the job reaches its terminal state.
    const stoppedRow = row({ status: "stopped", last_state: "waiting" });
    const during = followUpCardState(stoppedRow, { status: "running" });
    const afterPoll = followUpCardState(stoppedRow, { status: "failed" });
    assert.deepEqual(cardChip(during)?.text, "Stopping…");
    assert.deepEqual(cardChip(afterPoll)?.text, "Stopped");
  });

  it("writes a time of day the way the cards do, and nothing at all for a bad stamp", () => {
    assert.equal(clockLabel(at(2026, 9, 26, 7, 48).toISOString()), "7:48 a.m.");
    assert.equal(clockLabel(at(2026, 9, 26, 15, 5).toISOString()), "3:05 p.m.");
    assert.equal(clockLabel(at(2026, 9, 26, 0, 0).toISOString()), "12:00 a.m.");
    assert.equal(clockLabel(at(2026, 9, 26, 12, 0).toISOString()), "12:00 p.m.");
    for (const bad of [null, undefined, "", "whenever"]) assert.equal(clockLabel(bad), "");
  });

  it("says 'today' for a check later today and names the weekday otherwise", () => {
    const now = at(2026, 9, 26, 9, 0);
    assert.equal(nextCheckLabel(at(2026, 9, 26, 18, 0).toISOString(), now), "today 6:00 p.m.");
    assert.equal(nextCheckLabel(at(2026, 9, 29, 6, 0).toISOString(), now), "Tue 6:00 a.m.");
    assert.equal(nextCheckLabel(null, now), "");
    assert.equal(nextCheckLabel("whenever", now), "");
  });

  it("picks the trailing sentence per state", () => {
    const times = {
      lastRunAt: at(2026, 9, 26, 7, 48).toISOString(),
      nextRunAt: at(2026, 9, 29, 6, 0).toISOString(),
      from: at(2026, 9, 26, 9, 0),
    };
    assert.equal(cardTimeLine("found", times), "last run 7:48 a.m.");
    assert.equal(cardTimeLine("no-change", times), "last run 7:48 a.m.");
    assert.equal(cardTimeLine("could-not-check", times), "last tried 7:48 a.m.");
    assert.equal(cardTimeLine("waiting", times), "next check Tue 6:00 a.m.");
    assert.equal(cardTimeLine("running", { ...times, startedAt: at(2026, 9, 26, 8, 10).getTime() }), "started 8:10 a.m.");
    assert.equal(cardTimeLine("running", times), "");
    // A row that has never run but is scheduled: the sentence names the first
    // check rather than a run that did not happen.
    assert.equal(cardTimeLine("waiting", { nextRunAt: times.nextRunAt, from: times.from }), "next check Tue 6:00 a.m.");
  });

  it("leaves the result paragraph out of a run in flight", () => {
    // A running card says what the job is DOING; only the component holding
    // the job can know that.
    assert.equal(cardResultLine("running", parseFinding("{}"), {}), "");
  });

  it("writes the found, no-change and could-not-check paragraphs differently", () => {
    const found = parseFinding(packFinding({ title: "Meeting cancelled", summary: "It was called off." }));
    assert.equal(cardResultLine("found", found, {}), "It was called off.");
    assert.equal(
      cardResultLine("no-change", parseFinding("{}"), {}),
      "The pages were the same as the last check.",
    );
    // The reason is the agent's and the retry time is the clock's, so the
    // sentence is composed at the moment it is drawn.
    const failed = parseFinding(packFinding({ reason: "The page timed out." }));
    assert.equal(
      cardResultLine("could-not-check", failed, { nextRunAt: at(2026, 9, 26, 14, 0).toISOString() }),
      // No full stop after the clock: it already ends in "p.m.".
      "The page timed out. The agent will try again at 2:00 p.m.",
    );
    assert.equal(cardResultLine("could-not-check", failed, {}), "The page timed out.");
    assert.equal(
      cardResultLine("could-not-check", parseFinding("{}"), {}),
      "The check could not be completed.",
    );
  });

  it("says a stopped or finished agent will do nothing further", () => {
    assert.equal(
      cardResultLine("stopped", parseFinding("{}"), {}),
      "This agent was stopped. Nothing further will run.",
    );
    assert.equal(cardResultLine("done", parseFinding("{}"), {}), "This agent was marked done.");
    // A promise the database keeps: the result write is fenced on the stopped
    // status, so a run that is still unwinding cannot record anything.
    assert.equal(
      cardResultLine("stopping", parseFinding("{}"), {}),
      "Stopping — this run will not record anything more.",
    );
  });

  it("offers the drawn buttons, and takes 'Add to story' away once there is a story", () => {
    const keys = (state: FollowUpCardState, hasStory = false) =>
      cardActions(state, hasStory).map((action) => action.key);

    assert.deepEqual(keys("found"), ["review", "add-story", "done"]);
    // The note goes into that story's reporting notes the moment the story is
    // attached, so the button must not come back and append it again.
    assert.deepEqual(keys("found", true), ["review", "done"]);
    assert.deepEqual(keys("running"), ["pause", "edit", "stop"]);
    assert.deepEqual(keys("could-not-check"), ["run-now", "edit", "stop"]);
    assert.deepEqual(keys("waiting"), ["run-now", "edit", "stop"]);
    assert.deepEqual(keys("no-change"), ["run-now", "edit", "stop"]);
    assert.deepEqual(keys("stopped"), ["resume", "edit"]);
    assert.deepEqual(keys("done"), ["edit"]);
    assert.deepEqual(keys("manual"), []);
    // Nothing left to press while the cancelled run unwinds: Stop again would
    // change nothing, Run now is refused, and Resume would put the agent back
    // on the clock with a job on its way to `failed`.
    assert.deepEqual(keys("stopping"), ["edit"]);
  });

  it("labels the retry differently from the ordinary run", () => {
    assert.equal(cardActions("could-not-check", false)[0].label, "Retry now");
    assert.equal(cardActions("waiting", false)[0].label, "Run now");
    assert.equal(cardActions("found", false)[0].label, "Review finding");
  });
});

describe("what a stopped re-check left on", () => {
  it("names the pages still being watched, and where to turn them off", () => {
    // Nothing watched: the card says nothing at all rather than naming a watch
    // that is not there.
    assert.equal(watchNotice([]), null);
    assert.equal(watchNotice(["not a url"]), null, "an unparseable URL is not a page a card can name");

    assert.deepEqual(watchNotice(["https://www.clerk.test/agenda"]), {
      text: "A page watch for clerk.test is still on.",
      linkLabel: "Turn it off in Dark Desk.",
    });
    // Two targets that canonicalise to one page are one watch, and the sentence
    // does not name it twice.
    assert.deepEqual(
      watchNotice(["https://clerk.test/agenda?utm_source=x", "http://www.clerk.test/agenda"]),
      { text: "A page watch for clerk.test is still on.", linkLabel: "Turn it off in Dark Desk." },
    );
    assert.deepEqual(watchNotice(["https://clerk.test/agenda", "https://pool.test/hours"]), {
      text: "Page watches for clerk.test, pool.test are still on.",
      linkLabel: "Turn them off in Dark Desk.",
    });
  });
});

describe("the four filters", () => {  it("names each filter the way the drawn segment does", () => {
    assert.deepEqual(FOLLOW_UP_FILTERS, ["active", "found", "could-not-check", "stopped"]);
    assert.equal(FOLLOW_UP_FILTER_LABELS.active, "Active");
    assert.equal(FOLLOW_UP_FILTER_LABELS.found, "Found something");
    assert.equal(FOLLOW_UP_FILTER_LABELS["could-not-check"], "Could not check");
    assert.equal(FOLLOW_UP_FILTER_LABELS.stopped, "Stopped");
  });

  it("overlaps on purpose: a found row is in Active as well as in Found something", () => {
    const found = row({ last_state: "found", status: "active" });
    assert.equal(matchesFollowUpFilter(found, "active"), true);
    assert.equal(matchesFollowUpFilter(found, "found"), true);
    assert.equal(matchesFollowUpFilter(found, "could-not-check"), false);
    assert.equal(matchesFollowUpFilter(found, "stopped"), false);
  });

  it("counts a paused agent as active, because it is still being worked", () => {
    assert.equal(matchesFollowUpFilter(row({ status: "paused" }), "active"), true);
  });

  it("puts a stopped or finished agent only in Stopped", () => {
    for (const status of ["stopped", "done"] as const) {
      const ended = row({ status, last_state: "found" });
      assert.equal(matchesFollowUpFilter(ended, "stopped"), true);
      assert.equal(matchesFollowUpFilter(ended, "active"), false);
      assert.equal(matchesFollowUpFilter(ended, "found"), false);
    }
  });

  it("accounts for every agent row across the four filters", () => {
    const rows = [
      row({ last_state: "found" }),
      row({ last_state: "could-not-check" }),
      row({ last_state: "no-change" }),
      row({ last_state: null }),
      row({ status: "stopped" }),
      row({ status: "done" }),
    ];
    const unfiltered = rows.filter((r) => FOLLOW_UP_FILTERS.some((f) => matchesFollowUpFilter(r, f)));
    assert.equal(unfiltered.length, rows.length);
  });

  it("puts a manual ask in none of them: the filter counts are the agents'", () => {
    const manual = row({ agent_kind: null, status: "open" });
    for (const filter of FOLLOW_UP_FILTERS) {
      assert.equal(matchesFollowUpFilter(manual, filter), false);
    }
  });
});

/*
  UNIT U24 -- EVERY FILTER CARRIES ITS COUNT, INCLUDING "STOPPED".

  The stand-in editorial day: an agent was stopped, the card left Active (which
  then read "Nothing is running or waiting right now"), and the Stopped filter
  -- the only place the agent still existed -- was drawn without a number. The
  design drawing writes that one pill bare, and that is exactly why the agent
  looked deleted. An editor who has just pressed Stop needs to see something is
  over there.
*/
describe("U24: the follow-up filters show what is behind them", () => {
  it("counts every filter, Stopped included", () => {
    for (const key of FOLLOW_UP_FILTERS) {
      const label = followUpFilterLabel(key, 3);
      assert.equal(label, `${FOLLOW_UP_FILTER_LABELS[key]} · 3`);
    }
    assert.equal(followUpFilterLabel("stopped", 1), "Stopped · 1");
    /* A zero is a real answer here: "Stopped · 0" says the filter is empty,
       which is different from the pill saying nothing at all. */
    assert.equal(followUpFilterLabel("stopped", 0), "Stopped · 0");
  });

  it("says where a stopped agent went, on the press that stopped it", () => {
    const notice = followUpStoppedNotice();
    assert.match(notice, /^Stopped — find it under Stopped\./);
    assert.match(notice, /run in flight stops at its next step/);
  });
});
