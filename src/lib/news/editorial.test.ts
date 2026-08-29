import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NEWSROOM_NOTE,
  buildEditorialPack,
  opinionHeadline,
  parseEditorial,
} from "./editorial.ts";

/** The shape the voice file says it delivers, in its stated order. */
const DELIVERED = `The rail district wants your money twice

Longmont has been paying for a train since 2004. The train has not come.

Now a second district wants a second tax for the same tracks.

CLAIMS AND SOURCES

[Longmont voters approved the FasTracks tax in 2004] Source: https://www.rtd-denver.com/fastracks (primary document; accessed 2026-08-29)

EDITOR'S FACT SHEET

Names and titles: Claire Levy, Boulder County Commissioner, per bouldercounty.gov
Meeting citations: FRPRD board, 2026-08-27, item 7, 01:12:40

SOCIAL MEDIA IMAGE PROMPT

A empty commuter platform at dusk, Longmont water tower behind it.`;

describe("parseEditorial", () => {
  it("splits the five parts the voice delivers", () => {
    const e = parseEditorial(DELIVERED);
    assert.equal(e.headline, "The rail district wants your money twice");
    assert.match(e.body, /paying for a train since 2004/);
    assert.doesNotMatch(e.body, /CLAIMS AND SOURCES/, "the body must stop at the appendix");
    assert.match(e.appendix, /rtd-denver\.com/);
    assert.match(e.factSheet, /Claire Levy/);
    assert.match(e.imagePrompt, /commuter platform/);
  });

  /**
   * The voice file says to omit the appendix entirely when it had no web
   * tools. A piece with only a headline and a body is a real outcome, not a
   * parsing failure — but losing the body never is.
   */
  it("accepts a piece with no appendix", () => {
    const e = parseEditorial("A headline\n\nThe body of the piece.");
    assert.equal(e.headline, "A headline");
    assert.equal(e.body, "The body of the piece.");
    assert.equal(e.appendix, "");
  });

  /**
   * From the first real run on the Opinion desk. The voice file bans a
   * preamble; this piece opened with one anyway, and the handover sentence
   * became the headline while the real headline was pushed into the body.
   */
  it("skips a line that hands the piece over instead of titling it", () => {
    const e = parseEditorial(
      "Two portals, one lead that didn't survive contact with the record. Here's the piece.\n\n" +
        "The golf course advisory board posts its minutes. The city council doesn't.\n\n" +
        "Open the city's agenda portal and pull up the Water Board meeting.",
    );
    assert.equal(
      e.headline,
      "The golf course advisory board posts its minutes. The city council doesn't.",
    );
    assert.match(e.body, /Water Board meeting/);
    assert.doesNotMatch(e.body, /Here's the piece/, "the preamble must not survive into the body");
  });

  /**
   * The second real run. A whole working note, then a rule, then the piece.
   * The note became the headline and "Longmont published thirty news releases
   * in August" — the actual headline — was pushed into the body.
   */
  it("drops a working note that ends in a rule", () => {
    const e = parseEditorial(
      "Agent 2 came back with a provable absence and one correction to my premise.\n\n" +
        "---\n\n" +
        "Longmont published thirty news releases in August. Not one mentioned the house that exploded.\n\n" +
        "Open the city's news release page and count.",
    );
    assert.equal(
      e.headline,
      "Longmont published thirty news releases in August. Not one mentioned the house that exploded.",
    );
    assert.match(e.body, /Open the city/);
    assert.doesNotMatch(e.body, /Agent 2/, "the note must not survive into the body");
  });

  it("keeps a rule that belongs to the piece", () => {
    const e = parseEditorial(
      "A real headline\n\nFirst paragraph.\n\nSecond.\n\nThird.\n\n" +
        "Fourth.\n\nFifth.\n\n---\n\nAn afterword.",
    );
    assert.equal(e.headline, "A real headline");
    assert.match(e.body, /First paragraph/);
  });

  it("never trades the whole piece for a trailing rule", () => {
    const e = parseEditorial("A headline\n\nBody.\n\n---");
    assert.equal(e.headline, "A headline");
    assert.match(e.body, /Body/);
  });

  /** Never trade a headline for a preamble rule. */
  it("keeps a preamble as the headline when it is all there is", () => {
    assert.equal(parseEditorial("Here's the piece.").headline, "Here's the piece.");
  });

  it("does not mistake an ordinary headline for a preamble", () => {
    for (const h of [
      "The rail district wants your money twice",
      "Here is what the packet does not say",
      "A piece of the budget nobody reads",
    ]) {
      assert.equal(parseEditorial(h + "\n\nBody.").headline, h);
    }
  });

  it("strips markdown hashes the voice bans anyway", () => {
    assert.equal(parseEditorial("# A headline\n\nBody.").headline, "A headline");
  });

  /**
   * A real delivery came back as `**Longmont Has the Answers. Publish Them.**`
   * and the asterisks reached the desk. Hashes were stripped; emphasis was not.
   */
  it("strips emphasis from the headline too", () => {
    const cases: [string, string][] = [
      ["**Longmont Has the Answers. Publish Them.**", "Longmont Has the Answers. Publish Them."],
      ["*A headline*", "A headline"],
      ["_A headline_", "A headline"],
      ["## **A headline**", "A headline"],
    ];
    for (const [raw, want] of cases) {
      assert.equal(parseEditorial(raw + "\n\nBody.").headline, want);
    }
  });

  it("leaves emphasis that is only part of the headline", () => {
    assert.equal(
      parseEditorial("The **rail** district wants your money\n\nBody.").headline,
      "The **rail** district wants your money",
    );
  });

  it("never loses the body to a missing section", () => {
    for (const raw of [DELIVERED, "H\n\nB", "H\n\nB\n\nEDITOR'S FACT SHEET\n\nx"]) {
      assert.ok(parseEditorial(raw).body.trim().length > 0, "body vanished");
    }
  });

  it("returns empty parts rather than throwing on nothing", () => {
    for (const raw of ["", "   ", null as never, undefined as never]) {
      const e = parseEditorial(raw);
      assert.equal(typeof e.headline, "string");
      assert.equal(typeof e.body, "string");
    }
  });
});

describe("opinionHeadline", () => {
  /** The operator's rule: it cannot be mistaken for anything else. */
  it("prefixes OPINION once", () => {
    assert.equal(opinionHeadline("The rail tax"), "OPINION: The rail tax");
  });

  it("does not double the prefix", () => {
    assert.equal(opinionHeadline("OPINION: The rail tax"), "OPINION: The rail tax");
    assert.equal(opinionHeadline("Opinion — The rail tax"), "OPINION: The rail tax");
  });

  it("survives an empty headline", () => {
    assert.equal(opinionHeadline(""), "OPINION");
  });
});

describe("the pack hands over leads, not conclusions", () => {
  const pack = buildEditorialPack({
    subject: "Front Range Passenger Rail sales tax",
    ourStory: {
      headline: "Longmont is inside the rail district",
      url: "https://townreporter.org/articles/x",
      dek: "A second tax for the same tracks.",
    },
    pointers: [
      { what: "SB21-238, the statute that created the district", url: "https://leg.colorado.gov/bills/SB21-238" },
      { what: "The board's referral resolution — not published anywhere we could find" },
    ],
  });

  /**
   * The voice file's machine-assisted leads rule: a scan result or AI draft is
   * a lead, never a source. Handing over the desk's conclusions would make the
   * editorial a rewrite of a machine's opinion — the exact thing it refuses.
   */
  it("says plainly that the desk material is unverified", () => {
    assert.match(pack, /pointers, not findings/i);
    assert.match(pack, /Nothing in it has been verified/i);
    assert.match(pack, /open the originals yourself/i);
  });

  it("marks the paper's own reporting as citable", () => {
    assert.match(pack, /TownReporter's own published reporting IS a citable source/);
    assert.match(pack, /townreporter\.org\/articles\/x/);
  });

  it("tells it to run unsigned", () => {
    assert.match(pack, /unsigned, as the paper's own editorial position/);
    assert.match(pack, /Write no byline/);
  });

  it("carries a pointer that has no URL", () => {
    assert.match(pack, /not published anywhere we could find/);
  });

  it("still works with no pointers at all", () => {
    const bare = buildEditorialPack({ subject: "Water rates", pointers: [] });
    assert.match(bare, /start from the subject line/);
    assert.match(bare, /Water rates/);
  });

  /**
   * The voice file took months and the operator says small changes break it,
   * so it is never edited. The per-call note may add facts this newsroom knows
   * — that its own reporting is citable, that the piece runs unsigned — but it
   * must not restyle anything. Naming the file is fine; telling it how to
   * write is not.
   */
  it("adds newsroom facts without restyling the piece", () => {
    const styling = /\b(tone|sentence length|paragraph|word count|be more|write shorter|use fewer|adopt a)\b/i;
    assert.doesNotMatch(NEWSROOM_NOTE, styling);
    assert.match(NEWSROOM_NOTE, /stands unchanged/, "must say the rest of the file is untouched");
  });
});

/**
 * Opinion is the one feature that genuinely needs the Claude Code CLI, and it
 * must say so rather than quietly overriding the operator.
 *
 * It cannot go through the provider chain: the voice is passed as
 * --system-prompt-file so the file never becomes a command-line argument, and
 * the piece is written with WebSearch and WebFetch. No OpenAI-compatible
 * endpoint offers either. That exception is legitimate — but the audit
 * (TW-001) was right that it was undocumented and unchecked: editorial.server
 * called claudeCodeChat directly, so an operator who had explicitly set
 * TOWNREPORTER_CLAUDE_CODE=0 still got the CLI used behind their back.
 *
 * Refusing clearly is the honest behaviour. Silently ignoring the setting is
 * not.
 */
describe("the editorial writer respects a disabled CLI", () => {
  it("checks the CLI is allowed before it spends anything", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./editorial.server.ts", import.meta.url), "utf8"),
    );
    assert.match(
      src,
      /TOWNREPORTER_CLAUDE_CODE|claudeCodeDisabled|resolveClaudeCode/,
      "it must consult the operator's CLI setting, not just call the CLI",
    );
  });

  it("refuses before the voice file is even looked up", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./editorial.server.ts", import.meta.url), "utf8"),
    );
    const cliCheck = src.search(/TOWNREPORTER_CLAUDE_CODE|claudeCodeDisabled|resolveClaudeCode/);
    const voiceLookup = src.indexOf("findVoiceFile()");
    assert.ok(cliCheck > -1 && voiceLookup > -1, "both steps must exist");
    assert.ok(
      cliCheck < voiceLookup,
      "the cheap refusal comes first — no point reading a voice file we cannot use",
    );
  });
});
