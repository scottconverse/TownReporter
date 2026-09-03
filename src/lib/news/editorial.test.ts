import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NEWSROOM_NOTE,
  RESEARCH_INSTRUCTIONS,
  buildEditorialPack,
  buildWritingPack,
  opinionHeadline,
  parseEditorial,
} from "./editorial.ts";

/** The shape the voice file says it delivers, in its stated order. */
const DELIVERED = `The rail district wants your money twice

Longmont has been paying for a train since 2004. The train has not come.

Now a second district wants a second tax for the same tracks.

That is not a technical footnote. It is the central question the district owes Longmont before it asks for another dollar. Voters can support regional rail and still insist that public agencies account for the promises already financed in their name. The new district should publish a plain-language ledger of the old tax, the work completed, the work deferred, and the exact service this second levy would buy. Until that record is public, the honest answer is no. Longmont should not write a second blank check to the same tracks while the first train remains a promise on a map.

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
      {
        what: "SB21-238, the statute that created the district",
        url: "https://leg.colorado.gov/bills/SB21-238",
      },
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
    const styling =
      /\b(tone|sentence length|paragraph|word count|be more|write shorter|use fewer|adopt a)\b/i;
    assert.doesNotMatch(NEWSROOM_NOTE, styling);
    assert.match(NEWSROOM_NOTE, /stands unchanged/, "must say the rest of the file is untouched");
  });
});

/** Claude remains an explicit Opinion choice and must honor its CLI switch. */
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

  it("checks the Claude setting before its research call", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./editorial.server.ts", import.meta.url), "utf8"),
    );
    const claudeBranch = src.indexOf("runClaudePair:");
    const cliCheck = src.indexOf("resolveClaudeCode()", claudeBranch);
    const researchCall = src.indexOf("const research = await claudeCodeChat", claudeBranch);
    assert.ok(claudeBranch > -1 && cliCheck > claudeBranch && researchCall > cliCheck);
  });
});

type EditorialChatResult = { ok: true; text: string } | { ok: false; error: string };

type EditorialRuntime = {
  findVoiceFile: () => Promise<
    { ok: true; voice: { path: string; bytes: number } } | { ok: false; error: string }
  >;
  runClaudePair: () => Promise<EditorialChatResult>;
  runLocalPair: () => Promise<EditorialChatResult>;
  fileEditorial: () => Promise<{
    ok: true;
    draftId: number;
    headline: string;
    words: number;
    hadAppendix: boolean;
  }>;
  timeoutMs: () => number;
};

type EditorialOrchestrator = (
  input: {
    userId: string;
    newsroomId: number;
    subject: string;
    pointers: [];
    sourceKind: string;
    sourceRef: string;
    modelChoice: string;
  },
  runtime: EditorialRuntime,
) => Promise<
  | {
      ok: true;
      draftId: number;
      headline: string;
      words: number;
      hadAppendix: boolean;
      modelChoice: "claude-frontier" | "local-model";
    }
  | { ok: false; error: string }
>;

async function loadEditorialOrchestrator(): Promise<EditorialOrchestrator> {
  const loaded = await import("./editorial-orchestration.ts").catch(() => ({}));
  const candidate = (loaded as Record<string, unknown>).orchestrateEditorial;
  assert.equal(
    typeof candidate,
    "function",
    "Opinion needs a runtime orchestration seam used by writeEditorial",
  );
  return candidate as EditorialOrchestrator;
}

const ORCHESTRATION_INPUT = {
  userId: "editor-1",
  newsroomId: 1,
  subject: "Longmont budget",
  pointers: [] as [],
  sourceKind: "paste",
  sourceRef: "desk",
  modelChoice: "auto",
};

function claudeRuntime(events: string[], reply: EditorialChatResult) {
  const runtime: EditorialRuntime = {
    async findVoiceFile() {
      events.push("voice:locate");
      return { ok: true, voice: { path: "C:\\private\\voice.md", bytes: 1_024 } };
    },
    async runClaudePair() {
      events.push("claude");
      return reply;
    },
    // Poison pill: Automatic and an explicit "claude-frontier" pick must
    // never reach for the local pair. See audit finding "Opinion 'Local
    // model' pick silently uses Claude" -- the fix for that bug runs in the
    // opposite direction too, and this guards it.
    async runLocalPair() {
      events.push("local");
      throw new Error("Automatic/claude-frontier must never run the Local model pair");
    },
    async fileEditorial() {
      events.push("file");
      return {
        ok: true,
        draftId: 41,
        headline: "OPINION: A budget headline",
        words: 4,
        hadAppendix: false,
      };
    },
    timeoutMs: () => 60_000,
  };
  return runtime;
}

/**
 * Audit finding "Opinion 'Local model' pick silently uses Claude": before the
 * fix, `orchestrateEditorial` always called `runtime.runClaudePair()` no
 * matter what `modelChoice` said. `runClaudePair` is a poison pill here so
 * any regression back to that bug fails loudly instead of quietly drafting
 * on Claude in a test that only checks `runLocalPair` was reached.
 */
function localRuntime(events: string[], reply: EditorialChatResult) {
  const runtime: EditorialRuntime = {
    async findVoiceFile() {
      events.push("voice:locate");
      return { ok: true, voice: { path: "C:\\private\\voice.md", bytes: 1_024 } };
    },
    async runClaudePair() {
      events.push("claude");
      throw new Error("an explicit local-model pick must never run the Claude pair");
    },
    async runLocalPair() {
      events.push("local");
      return reply;
    },
    async fileEditorial() {
      events.push("file");
      return {
        ok: true,
        draftId: 42,
        headline: "OPINION: A local budget headline",
        words: 4,
        hadAppendix: false,
      };
    },
    timeoutMs: () => 60_000,
  };
  return runtime;
}

/*
  Opinion is Claude-only. Codex sat on this picker for one release candidate
  and its model refused the job every time it was asked for an editorial that
  takes a position -- the provider's policy, not a bug. These tests pin the
  shape that replaced it: one provider, one pair, and refusals still never
  become a headline.
*/
describe("Opinion runs one Claude pair", () => {
  it("Automatic runs locate -> Claude pair -> file, and nothing else", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const result = await orchestrateEditorial(
      ORCHESTRATION_INPUT,
      claudeRuntime(events, { ok: true, text: DELIVERED }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) assert.fail(result.error);
    assert.equal(result.modelChoice, "claude-frontier");
    assert.deepEqual(events, ["voice:locate", "claude", "file"]);
  });

  it("an explicit Claude choice does the same", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const result = await orchestrateEditorial(
      { ...ORCHESTRATION_INPUT, modelChoice: "claude-frontier" },
      claudeRuntime(events, { ok: true, text: DELIVERED }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(events, ["voice:locate", "claude", "file"]);
  });

  it("a stored Codex choice from the withdrawn picker lands on Claude instead of failing", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const result = await orchestrateEditorial(
      { ...ORCHESTRATION_INPUT, modelChoice: "codex-frontier" },
      claudeRuntime(events, { ok: true, text: DELIVERED }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) assert.fail(result.error);
    assert.equal(result.modelChoice, "claude-frontier");
  });

  it("does not file when the voice file is missing", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const runtime = claudeRuntime(events, { ok: true, text: DELIVERED });
    runtime.findVoiceFile = async () => ({ ok: false, error: "No voice file" });
    const result = await orchestrateEditorial(ORCHESTRATION_INPUT, runtime);
    assert.equal(result.ok, false);
    assert.deepEqual(events, []);
  });

  it("reports the Claude failure and files nothing", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const result = await orchestrateEditorial(
      ORCHESTRATION_INPUT,
      claudeRuntime(events, { ok: false, error: "Claude is unavailable." }),
    );
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("filed on a failed pair");
    assert.match(result.error, /Claude is unavailable/);
    assert.equal(events.includes("file"), false);
  });

  for (const opening of [
    "EDITORIAL_REFUSAL: I can't provide an editorial that advocates a position on a local government policy issue.",
    "I'm sorry, I cannot write the requested advocacy editorial. Here is a neutral summary instead.\n\nRecords exist.",
    "As an AI language model, I can't take a position.\n\nThe budget is large.",
  ]) {
    it(`does not file a refusal as an editorial: ${opening.slice(0, 40)}`, async () => {
      const orchestrateEditorial = await loadEditorialOrchestrator();
      const events: string[] = [];
      const result = await orchestrateEditorial(
        ORCHESTRATION_INPUT,
        claudeRuntime(events, { ok: true, text: opening }),
      );
      assert.equal(result.ok, false);
      if (result.ok) assert.fail("a refusal was filed");
      assert.match(result.error, /declined|Nothing was filed/i);
      assert.equal(events.includes("file"), false);
    });
  }

  it("files legitimate editorial disagreement -- a piece may refuse to endorse", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const piece = DELIVERED.replace(
      /^([^\n]*\n)/,
      "$1We cannot endorse a second sales tax for the same rail promise.\n",
    );
    const result = await orchestrateEditorial(
      ORCHESTRATION_INPUT,
      claudeRuntime(events, { ok: true, text: piece }),
    );
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    assert.equal(events.includes("file"), true);
  });

  it("the Opinion path carries no Codex runtime at all", async () => {
    const src = await import("node:fs").then((fs) =>
      ["./editorial.server.ts", "./editorial-orchestration.ts"]
        .map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8"))
        .join("\n"),
    );
    assert.doesNotMatch(
      src,
      /codexChat|readVoiceTextForOpenAiCodex|codexModel|ai-codex\.server/,
      "Codex has no seat on the Opinion desk; if it returns, its refusal problem returns with it",
    );
  });
});

/*
  Audit finding "Opinion 'Local model' pick silently uses Claude" (BLOCKER):
  `orchestrateEditorial` used to call `runtime.runClaudePair()` unconditionally,
  so an explicit "local-model" pick drafted on Claude anyway. Local models can
  write editorials -- there is no refusal problem the way Codex had -- so
  "local-model" must be a fully working, independently-dispatched choice.
*/
describe("Opinion runs one Local model pair when explicitly picked", () => {
  it("an explicit local-model choice runs locate -> local pair -> file, and never touches Claude", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const result = await orchestrateEditorial(
      { ...ORCHESTRATION_INPUT, modelChoice: "local-model" },
      localRuntime(events, { ok: true, text: DELIVERED }),
    );
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    if (!result.ok) return;
    assert.equal(result.modelChoice, "local-model");
    assert.deepEqual(events, ["voice:locate", "local", "file"]);
  });

  it("does not file when the voice file is missing", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const runtime = localRuntime(events, { ok: true, text: DELIVERED });
    runtime.findVoiceFile = async () => ({ ok: false, error: "No voice file" });
    const result = await orchestrateEditorial(
      { ...ORCHESTRATION_INPUT, modelChoice: "local-model" },
      runtime,
    );
    assert.equal(result.ok, false);
    assert.deepEqual(events, []);
  });

  it("reports the local pair's failure and files nothing, and does not blame Claude", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const result = await orchestrateEditorial(
      { ...ORCHESTRATION_INPUT, modelChoice: "local-model" },
      localRuntime(events, { ok: false, error: "LLM is unreachable." }),
    );
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("filed on a failed pair");
    assert.match(result.error, /LLM is unreachable/);
    assert.doesNotMatch(result.error, /Claude/i);
    assert.equal(events.includes("file"), false);
  });

  it("does not file a local-model refusal as an editorial", async () => {
    const orchestrateEditorial = await loadEditorialOrchestrator();
    const events: string[] = [];
    const result = await orchestrateEditorial(
      { ...ORCHESTRATION_INPUT, modelChoice: "local-model" },
      localRuntime(events, {
        ok: true,
        text: "EDITORIAL_REFUSAL: I can't take a position on this.",
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("a refusal was filed");
    assert.match(result.error, /declined|Nothing was filed/i);
    assert.equal(events.includes("file"), false);
  });
});
