import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  selectExcerpt,
  addHumanLine,
  applyTodoPatch,
  keepHumanTodos,
  machineTodosFrom,
  notesHaveMemo,
  parseNotes,
  toggleTodo,
  packNotes,
  splitTodoLine,
} from "./notes.ts";

describe("reporting notes", () => {
  it("keeps human lines through a machine replace", () => {
    const prev = parseNotes(
      JSON.stringify({
        news: "old",
        todo: [
          { t: "Call planning", done: true, src: "you" },
          { t: "SEC filing", done: false, src: "machine" },
        ],
      }),
    );
    const kept = keepHumanTodos(prev);
    const machine = machineTodosFrom(["Leader S-1", "Call planning"]);
    const next = { ...prev, news: "new", todo: [...kept, ...machine] };
    assert.equal(next.news, "new");
    assert.equal(next.todo.filter((t) => t.src === "you").length, 1);
    assert.equal(next.todo.find((t) => t.src === "you")?.done, true);
    assert.ok(next.todo.some((t) => t.t === "Leader S-1"));
  });

  it("strikes and restores without deleting", () => {
    let n = addHumanLine(parseNotes("{}"), "Pull the packet");
    n = toggleTodo(n, 0);
    assert.equal(n.todo[0]?.done, true);
    n = toggleTodo(n, 0);
    assert.equal(n.todo[0]?.done, false);
    assert.equal(n.todo.length, 1);
  });

  it("empty memo vs filled", () => {
    assert.equal(notesHaveMemo(parseNotes("{}")), false);
    assert.equal(notesHaveMemo(parseNotes(JSON.stringify({ news: "Plant opened." }))), true);
  });

  it("toggle works on a displayed list that was never saved", () => {
    const shown = machineTodosFrom(["Address of the plant", "SEC filing"]);
    const next = applyTodoPatch(parseNotes("{}"), { todos: shown, toggle: 0 });
    assert.equal(next.todo[0]?.done, true);
    assert.equal(next.todo[1]?.done, false);
    assert.equal(next.todo.length, 2);
  });

  it("keeps a pull-box scratch across a machine replace", () => {
    const prev = parseNotes(
      JSON.stringify({
        news: "old",
        scratch: "From the company PR: 155 jobs.",
        todo: [{ t: "Call planning", done: false, src: "you" }],
      }),
    );
    assert.match(prev.scratch, /155 jobs/);
    const kept = keepHumanTodos(prev);
    const next = { ...prev, news: "new", todo: kept, scratch: prev.scratch };
    assert.match(next.scratch, /155 jobs/);
  });
});

describe("packNotes", () => {
  const big = (n: number) => "x".repeat(n);
  const base = () => ({
    news: "The district referred a sales tax.",
    why: "It taxes Longmont.",
    angle: "Longmont is inside the boundary.",
    todo: [{ t: "Get the adopted resolution", done: false, src: "you" as const }],
    found: [{ t: big(700), src: "https://example.gov/a" }],
    verify: ["checked"],
    opened: [
      { url: "https://example.gov/a", title: "A" },
      { url: "https://example.gov/b", title: "B" },
    ],
    scratch: big(8000),
  });

  it("always returns JSON that parses back", () => {
    const packed = packNotes(base(), 500);
    assert.doesNotThrow(() => JSON.parse(packed));
  });

  /**
   * The regression. `JSON.stringify(notes).slice(0, 16000)` wrote a string that
   * ended mid-token, so the very next read produced empty notes and the lead
   * silently lost its memo, its documents and every pulled excerpt.
   */
  it("never truncates mid-token the way the old slice did", () => {
    const notes = base();
    const naive = JSON.stringify(notes).slice(0, 500);
    assert.throws(() => JSON.parse(naive), "the old behaviour must still be broken");
    const packed = packNotes(notes, 500);
    assert.ok(packed.length <= 500);
    assert.doesNotThrow(() => JSON.parse(packed));
  });

  it("leaves notes that already fit completely alone", () => {
    const notes = base();
    assert.equal(packNotes(notes, 100_000), JSON.stringify(notes));
  });

  it("drops scratch before it drops the memo or the to-do list", () => {
    const parsed = JSON.parse(packNotes(base(), 900)) as Record<string, unknown>;
    assert.equal(parsed.news, "The district referred a sales tax.");
    assert.equal((parsed.todo as unknown[]).length, 1);
    assert.ok(String(parsed.scratch).length < 8000);
  });

  it("keeps the newest end of scratch, not the oldest", () => {
    const notes = base();
    notes.scratch = `${big(4000)}NEWEST-PULL`;
    const parsed = JSON.parse(packNotes(notes, 1200)) as { scratch: string };
    assert.match(parsed.scratch, /NEWEST-PULL/);
  });

  it("survives a to-do list that alone exceeds the budget", () => {
    const notes = base();
    notes.todo = Array.from({ length: 24 }, () => ({
      t: big(400),
      done: false,
      src: "machine" as const,
    }));
    const packed = packNotes(notes, 600);
    assert.doesNotThrow(() => JSON.parse(packed));
  });
});

describe("splitTodoLine", () => {
  /** The exact line that sent a PULL to three California school districts. */
  const RUN_ON =
    "Get the district board's adopted resolution and the certified ballot title text — those are the two documents that settle rate, boundary, sunset and debt. Then the board packet and minutes for the August 2026 meeting, and the district's enabling statute SB 21-238 and its boundary map.";

  it("breaks a run-on into separate errands", () => {
    const parts = splitTodoLine(RUN_ON);
    assert.ok(parts.length >= 2, "a six-document line must not stay one line");
    for (const p of parts) assert.ok(p.length <= 200, `piece too long: ${p}`);
  });

  it("leaves a line that is already one errand alone", () => {
    const one = "Get the adopted resolution referring the tax to the November ballot";
    assert.deepEqual(splitTodoLine(one), [one]);
  });

  it("does not leave a stub piece behind", () => {
    const parts = splitTodoLine(
      `${"Get the signed referral resolution from the district board and its exhibit. "}Yes. And then the certified ballot title text as adopted by the board on the night of the vote.`,
    );
    for (const p of parts) assert.ok(p.length >= 20, `stub piece: "${p}"`);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(splitTodoLine("   "), []);
  });

  /*
    A real machine follow-up line rendered as three rows on the Story page's
    "Still to pull" list: the splitter read "Aug." and "Sept." as sentence
    ends. Both abbreviations sit inside one still-open parenthetical too, so
    this also proves the "don't split inside an unclosed paren" half of the
    fix, not just the abbreviation list.
  */
  it("does not split on a month abbreviation's period, even inside a parenthetical", () => {
    const line =
      "check City Council agendas and packets from August-September 2026 (including the Aug. 25 budget introduction and the Sept. 1 regular session, whose minutes are still unposted)";
    assert.deepEqual(splitTodoLine(line), [line]);
  });

  it("does not split on other common abbreviations (titles, streets, U.S., etc.)", () => {
    const line =
      "Ask Dr. Alvarez and Mr. Chen at 400 Main St. for the U.S. Census tract map the staff report cites, and confirm the vendor is Acme Co. per the Inc. filing before Friday, etc.";
    assert.deepEqual(splitTodoLine(line), [line]);
  });

  it("still splits a real sentence end that happens to follow other text", () => {
    const line =
      "Get the resolution and the ballot title text — those are the two documents that settle rate, boundary, sunset and debt. Then the board packet and minutes for the August 2026 meeting, plus the U.S. Census tract map the staff report cites, and confirm with the county clerk before Friday.";
    const parts = splitTodoLine(line);
    assert.ok(parts.length >= 2, "a two-sentence line must still split");
    assert.ok(!parts.some((p) => /U\.$/.test(p) || /U\.S$/.test(p)), "must not split inside U.S.");
  });

  it("machineTodosFrom produces more, shorter lines from one run-on", () => {
    const todos = machineTodosFrom([RUN_ON]);
    assert.ok(todos.length >= 2);
    assert.equal(todos.every((t) => t.src === "machine"), true);
  });

  it("machineTodosFrom still caps the list", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Get document number ${i} from the clerk`);
    assert.equal(machineTodosFrom(many).length, 16);
  });
});

describe("selectExcerpt", () => {
  const noisyPage = [
    "Home",
    "Agendas & Minutes",
    "Departments | Services | Pay My Bill",
    "Skip to content",
    "",
    "City of Longmont",
    "",
    "The council voted 6-1 to delay the NextLight rate change after the packet was revised the night before the meeting. The revised fiscal note moved the effective date to January.",
    "",
    "Council member Ruiz said the change deserved a full public reading before any vote.",
    "",
    "Subscribe to our newsletter",
    "Privacy Policy | Terms",
  ].join("\n");

  it("returns the passage that matches the pulled line, not the page top", () => {
    const out = selectExcerpt(noisyPage, "NextLight rate change delayed by council vote");
    assert.match(out, /voted 6-1 to delay the NextLight rate change/);
    assert.doesNotMatch(out, /Pay My Bill|Skip to content|Privacy Policy/);
  });

  it("keeps paragraph breaks instead of flattening to one line", () => {
    const out = selectExcerpt(noisyPage, "NextLight rate change council");
    assert.ok(out.includes("\n\n"), "consecutive kept paragraphs must stay separated");
    assert.match(out, /Ruiz said/);
  });

  it("falls back past short nav rows when nothing matches the line", () => {
    const out = selectExcerpt(noisyPage, "zzz qqqq xxxxx");
    assert.match(out, /voted 6-1/, "the fallback must start at real prose, not the menu");
    assert.doesNotMatch(out, /Agendas & Minutes/);
  });

  it("never anchors on a title line, even when the title matches the query", () => {
    // The exact shape a live city page fooled the first version with: the
    // page <title> repeats the query words, then a skip-link, then a banner.
    const cityPage = [
      "Non-profits eligible for new NextLight discount - City of Longmont",
      "Skip to main content",
      "Take the 2026 Community Satisfaction Survey to help make a Longmont you love.",
      "The NextLight municipal broadband service will offer qualifying non-profit organizations a discounted rate beginning in October, the city announced, citing the rate ordinance packet approved last month.",
      "Subscribe | Privacy",
    ].join("\n");
    const out = selectExcerpt(cityPage, "NextLight rate ordinance packet");
    assert.match(out, /discounted rate beginning in October/, "must anchor on prose, not the title");
    assert.doesNotMatch(out, /Skip to main content/);
  });

  it("respects the cap", () => {
    const long = "word ".repeat(2000) + "\n\nneedle paragraph about the packet";
    assert.ok(selectExcerpt(long, "packet needle").length <= 1600);
  });
});
