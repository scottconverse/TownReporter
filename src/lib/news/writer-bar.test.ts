import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendStoryFailoverNote, failoverNoteSentence } from "./automatic-failover.ts";
import {
  availabilityChoice,
  customConnectionStatus,
  draftFallbackAttribution,
  failoverDestinationFromNote,
  geminiChipWord,
  lastDraftInHand,
  lastDraftLine,
  lastDraftWhen,
  modelAndResearchLabel,
  modelMoveFromNote,
  workingLabelText,
  writerNoteLabel,
  pastDraftPickName,
  readinessDot,
  readinessFailureMessage,
  recordedActualModelId,
  recordedRuntime,
  requestedModelChoice,
  runningWriterSentence,
  switchReasonFromNote,
  saveState,
  writerIsReady,
  writerUnavailableReason,
} from "./writer-bar.ts";
import { pastRunModelName } from "./model-choice.ts";
import { automaticLadder } from "./provider-registry.ts";

/**
 * The Writer / Effort bar's lines (unit CW, 0.6.81).
 *
 * These are short functions and the point is not the strings. It is that each
 * one refuses to say something the desk did not record, and that the dot
 * answers the same question the model picker answers -- "can this writer
 * run?" -- so the bar above the panel and the panel's own option list cannot
 * tell the editor two different things.
 */

const ready = { enabled: true, modelId: "gpt-5.6-sol" };

describe("writerIsReady", () => {
  /*
    Decision D276: Automatic is ready while at least one rung of its ladder can
    answer. The map is built from `automaticLadder()` and `availabilityChoice`
    so a rung added or reordered in the registry is covered without editing
    this test. A key the map does not list is not evidence that anything runs.
  */
  it("counts Automatic as ready while one rung of its ladder answers", () => {
    const rungs = automaticLadder().map(availabilityChoice);
    const allDown = Object.fromEntries(rungs.map((key) => [key, false]));
    assert.equal(
      writerIsReady({ choice: "auto", availability: allDown, customConnection: null }),
      false,
    );
    assert.equal(
      writerIsReady({
        choice: "auto",
        availability: { ...allDown, [rungs[0]!]: true },
        customConnection: null,
      }),
      true,
    );
    assert.equal(
      writerIsReady({ choice: "auto", availability: { codex: true }, customConnection: null }),
      false,
      "a key outside the ladder does not make Automatic ready",
    );
    assert.equal(
      writerIsReady({ choice: "auto", availability: undefined, customConnection: null }),
      true,
    );
  });

  it("gives Automatic the reason that says what to do about it", () => {
    const rungs = automaticLadder().map(availabilityChoice);
    const allDown = Object.fromEntries(rungs.map((key) => [key, false]));
    assert.equal(
      writerUnavailableReason({ choice: "auto", label: "Automatic", availability: allDown, customConnection: null }),
      "Not ready: none of the models Automatic uses is answering. Open Models to start one or sign in.",
    );
  });

  it("reads every other provider off the availability map", () => {
    assert.equal(
      writerIsReady({ choice: "codex", availability: { codex: true }, customConnection: null }),
      true,
    );
    assert.equal(
      writerIsReady({ choice: "codex", availability: { codex: false }, customConnection: null }),
      false,
    );
  });

  /*
    Undecided is not a verdict. A slow availability call must not say "Not set
    up" over a writer that is fine, and the run's own preflight is the backstop
    either way -- the same reason the picker's own check defaults to available.
  */
  it("does not call a writer unset-up while the answer is still coming", () => {
    assert.equal(
      writerIsReady({ choice: "codex", availability: undefined, customConnection: null }),
      true,
    );
  });

  it("needs a custom connection to be on and to carry a model", () => {
    const choice = "custom:8f14e45f-ceea-467a-9a3a-1f0a2b3c4d5e";
    assert.equal(
      writerIsReady({ choice, availability: undefined, customConnection: ready }),
      true,
    );
    assert.equal(
      writerIsReady({
        choice,
        availability: undefined,
        customConnection: { enabled: false, modelId: "gpt-5.6-sol" },
      }),
      false,
    );
    assert.equal(
      writerIsReady({ choice, availability: undefined, customConnection: { enabled: true, modelId: null } }),
      false,
    );
    assert.equal(writerIsReady({ choice, availability: undefined, customConnection: null }), false);
  });
});

describe("readinessDot", () => {
  it("carries the saved held-item reason to the Writer chip", () => {
    const reason = "Airport future charges: The future charge amount needs checking.";
    const status = readinessDot(true, { state: "not-ready", reason });
    assert.equal("reason" in status ? status.reason : undefined, reason);
  });
  it("says the drawn word for a writer that can run", () => {
    assert.deepEqual(readinessDot(true), { label: "● Ready", tone: "ok" });
  });

  /*
    The drawing has one state because the drawn writer is set up. The other
    state borrows the picker's own words for an option with no server behind
    it -- "not set up" -- so the dot, the option and the help line under the
    panel all use one phrase for one problem.
  */
  it("uses the picker's own words when the writer is not set up", () => {
    assert.deepEqual(readinessDot(false), { label: "● Not ready", tone: "warn" });
  });
});

describe("lastDraftWhen", () => {
  const now = new Date("2026-09-28T15:00:00");

  it("writes the drawn bare clock for a draft from today", () => {
    assert.equal(lastDraftWhen(new Date("2026-09-28T07:48:00").toISOString(), now), "7:48 a.m.");
  });

  /*
    The drawing's one clock is right on the morning it was drawn and wrong for
    a draft left over from yesterday, which would read as this morning's work.
  */
  it("carries the date once the draft is from another day", () => {
    assert.equal(lastDraftWhen(new Date("2026-09-26T07:48:00").toISOString(), now), "Sep 26, 7:48 a.m.");
  });

  it("is empty when the desk recorded no stamp at all", () => {
    assert.equal(lastDraftWhen(null, now), "");
    assert.equal(lastDraftWhen(undefined, now), "");
    assert.equal(lastDraftWhen("", now), "");
    assert.equal(lastDraftWhen("not a date", now), "");
  });
});

describe("lastDraftLine", () => {
  it("writes the drawn line from the model and the hour the desk recorded", () => {
    assert.equal(
      lastDraftLine({ modelLabel: "Codex Sol 6.1", when: "7:48 a.m." }),
      "Last draft: Codex Sol 6.1, 7:48 a.m.",
    );
  });

  /*
    A draft whose model the desk never wrote down is still a draft written at a
    known hour. "Last draft: 7:48 a.m." is true; "Last draft: , 7:48 a.m." is
    the separator leaking.
  */
  it("keeps the hour when there is no model to name", () => {
    assert.equal(lastDraftLine({ modelLabel: "", when: "7:48 a.m." }), "Last draft: 7:48 a.m.");
    assert.equal(lastDraftLine({ modelLabel: "   ", when: "7:48 a.m." }), "Last draft: 7:48 a.m.");
  });

  /*
    No draft job on the books means no hour, and then there is no line to draw
    -- `lastDraftWhen` is where that "" comes from.
  */
  it("draws no line at all when the desk recorded no time", () => {
    assert.equal(lastDraftLine({ modelLabel: "Codex Sol 6.1", when: "" }), "");
    assert.equal(lastDraftLine({ modelLabel: "Codex Sol 6.1", when: "   " }), "");
    assert.equal(lastDraftLine({ modelLabel: "", when: "" }), "");
  });
});

describe("saveState", () => {
  it("writes the drawn green line once the draft is on the books", () => {
    assert.deepEqual(saveState({ published: false, dirty: false, when: "8:20 a.m." }), {
      label: "Saved 8:20 a.m.",
      tone: "ok",
    });
  });

  /*
    The one line that must never lie. A green "Saved 8:20 a.m." beside text
    that exists only in this tab is the exact mistake a save line exists to
    prevent, so unsaved changes outrank the timestamp.
  */
  it("says unsaved changes rather than a green hour, whatever the last save was", () => {
    assert.deepEqual(saveState({ published: false, dirty: true, when: "8:20 a.m." }), {
      label: "Unsaved changes",
      tone: "warn",
    });
  });

  it("says the story is on the paper rather than pretending it is a draft", () => {
    assert.deepEqual(saveState({ published: true, dirty: false, when: "8:20 a.m." }), {
      label: "Published story",
      tone: "mut",
    });
  });

  it("falls back to the plain word when the desk recorded no hour", () => {
    assert.deepEqual(saveState({ published: false, dirty: false, when: "" }), {
      label: "Saved draft",
      tone: "ok",
    });
  });
});

it("keeps known quota and unknown provider messages visible", () => {
  assert.equal(readinessFailureMessage("custom:x", "My provider", "insufficient_quota"), "My provider hit its usage limit.");
  assert.equal(readinessFailureMessage("codex-frontier", "Codex", "Transport refused the request."), "Codex is not ready: Transport refused the request.");
});

it("puts a short word in the Gemini chip, never the explaining sentence", () => {
  // A chip is two words (`Chip`'s own comment); the sentence goes in its help.
  assert.equal(geminiChipWord("Ready", false), "Ready");
  assert.equal(geminiChipWord(undefined, true), "Checking");
  assert.equal(geminiChipWord(undefined, false), "Warning");
  assert.equal(
    geminiChipWord("The Gemini program was not found on this server. Install it, then check again.", false),
    "Not ready",
  );
  for (const word of ["Ready", "Checking", "Warning", "Not ready"]) {
    assert.ok(!/\s{2,}|\.$/.test(word) && word.length <= 12, `${word} is a chip word`);
  }
});

it("uses the picker key-read failure for the API connection status", () => {
  const connection = {
    id: "gemini",
    name: "Gemini",
    hasApiKey: true,
    enabled: true,
    readinessError: "The saved API key cannot be decrypted. Re-enter it in Server settings before drafting.",
  };
  const pickerReason = writerUnavailableReason({
    choice: "custom:gemini",
    label: "Gemini",
    availability: {},
    customConnection: { enabled: true, modelId: "gemini-3.5-flash", readinessError: connection.readinessError },
  });
  const connectionStatus = customConnectionStatus(connection);

  assert.equal(connectionStatus.kind, "unreachable");
  // The chip says the screen's word for an unreachable connection; the
  // sentence is the help and the card's own paragraph.
  assert.equal(connectionStatus.label, undefined);
  assert.equal(connectionStatus.help, pickerReason);
  assert.equal(connectionStatus.help, "Gemini (key) — key can't be read. Fix it in Server -> Connections.");
});

it("names the picked model, actual writer, and first failure after a fallback chain", () => {
  assert.equal(
    requestedModelChoice(
      JSON.stringify({ requestedRuntime: "gemini-pro", actualRuntime: "codex-balanced" }),
      "codex-balanced",
    ),
    "gemini-pro",
  );
  assert.equal(
    draftFallbackAttribution({
      pickedModel: "Gemini 3.1 Pro (Pro plan)",
      writerModel: "Codex Sol 6.1 (balanced)",
      failoverNote: "Gemini request timed out. -> DeepSeek v4.1 Flash 1017 -> DeepSeek v4.1 Flash 1017: Provider says: reply was cut off -> Codex Sol 6.1 (balanced)",
    }),
    "You picked Gemini 3.1 Pro (Pro plan). Codex Sol 6.1 (balanced) wrote this draft because Gemini 3.1 Pro (Pro plan) timed out.",
  );
  assert.equal(
    draftFallbackAttribution({
      pickedModel: "Gemini 3.1 Pro (Pro plan)",
      writerModel: "Gemini 3.1 Pro (Pro plan)",
      failoverNote: "Gemini request timed out.",
    }),
    undefined,
  );
});

describe("running writer and switch reason", () => {
  it("reads the sentence form of the durable failover note", () => {
    assert.equal(
      switchReasonFromNote("This draft moved to Codex Sol 6.1 (balanced) because Gemini timed out"),
      "Gemini timed out",
    );
  });

  it("reads the last hop of a trail note", () => {
    assert.equal(
      switchReasonFromNote("Gemini timed out -> Codex Sol 6.1 (balanced) timed out -> DeepSeek v4.1 Flash 1017"),
      "Codex Sol 6.1 (balanced) timed out",
    );
  });

  it("keeps a reason that itself contains an arrow, whole and without a second period", () => {
    const note = appendStoryFailoverNote(
      "This draft moved to Gemini (key) because Gemini (gemini-3.5-flash) cannot be read. Fix it in Server -> Connections.",
      "This draft moved to DeepSeek v4.1 Flash 1017 because Gemini (key) cannot be read. Fix it in Server -> Connections.",
    );
    assert.equal(
      runningWriterSentence({ pickedModel: "Gemini (gemini-3.5-flash)", writerModel: "DeepSeek v4.1 Flash 1017", failoverNote: note }),
      "You picked Gemini (gemini-3.5-flash). DeepSeek v4.1 Flash 1017 is writing because Gemini (key) cannot be read. Fix it in Server -> Connections.",
    );
  });

  it("invents no reason when the job recorded none", () => {
    assert.equal(switchReasonFromNote(""), undefined);
    assert.equal(switchReasonFromNote(null), undefined);
  });

  it("says what was picked, who is writing, and why", () => {
    assert.equal(
      runningWriterSentence({
        pickedModel: "Automatic",
        writerModel: "Codex Sol 6.1 (balanced)",
        failoverNote: "This draft moved to Codex Sol 6.1 (balanced) because Gemini timed out.",
      }),
      "You picked Automatic. Codex Sol 6.1 (balanced) is writing because Gemini timed out.",
    );
  });

  it("omits the reason when the job recorded none", () => {
    assert.equal(
      runningWriterSentence({ pickedModel: "Automatic", writerModel: "Codex Sol 6.1 (balanced)", failoverNote: "" }),
      "You picked Automatic. Codex Sol 6.1 (balanced) is writing.",
    );
  });

  it("says nothing when the writer is the pick", () => {
    assert.equal(
      runningWriterSentence({ pickedModel: "Automatic", writerModel: "Automatic", failoverNote: "" }),
      undefined,
    );
  });
});

describe("lastDraftInHand: the draft in hand keeps its model after a save message", () => {
  const finishedAt = "2026-10-12T16:53:00.000Z";
  it("still names the model after the page shows its own 'Draft saved.' message", () => {
    assert.match(
      lastDraftInHand({ hasDraft: true, civicReporting: false, jobStatus: "completed", modelLabel: "DeepSeek v4.1 Flash 1017", finishedAt }),
      /^Last draft: DeepSeek v4.1 Flash 1017, /,
    );
  });
  it("names a local run with its exact model", () => {
    assert.match(
      lastDraftInHand({ hasDraft: true, civicReporting: false, jobStatus: "completed", modelLabel: "Local model (deepseek-v4.1-flash:cloud)", finishedAt }),
      /^Last draft: Local model \(deepseek-v4\.1-flash:cloud\), /,
    );
  });
  it("says nothing when the latest job failed, because its model and time are not the draft's", () => {
    assert.equal(lastDraftInHand({ hasDraft: true, civicReporting: false, jobStatus: "failed", modelLabel: "Gemini Flash", finishedAt }), "");
  });
  it("says nothing for a civic-reporting draft or when there is no draft", () => {
    assert.equal(lastDraftInHand({ hasDraft: true, civicReporting: true, jobStatus: "completed", modelLabel: "Gemini Flash", finishedAt }), "");
    assert.equal(lastDraftInHand({ hasDraft: false, civicReporting: false, jobStatus: "completed", modelLabel: "Gemini Flash", finishedAt }), "");
  });
  it("names the fallback writer's attribution for an empty-draft switch", () => {
    assert.equal(
      draftFallbackAttribution({ pickedModel: "Codex Sol", writerModel: "Gemini Flash", failoverNote: "This draft moved to Gemini Flash because Codex Sol returned an empty draft." }),
      "You picked Codex Sol. Gemini Flash wrote this draft because Codex Sol returned an empty draft.",
    );
  });
  it("never says the Automatic pick timed out: the note names the model that did", () => {
    const sentence = draftFallbackAttribution({
      pickedModel: "Automatic",
      writerModel: "Codex Sol 6.1 (balanced)",
      failoverNote: "This draft moved to Codex Sol 6.1 (balanced) because DeepSeek v4.1 Flash 1017 timed out.",
    });
    assert.equal(
      sentence,
      "You picked Automatic. Codex Sol 6.1 (balanced) wrote this draft because DeepSeek v4.1 Flash 1017 timed out.",
    );
    assert.doesNotMatch(sentence ?? "", /Automatic timed out/);
  });
});

/*
  TJA-3: Automatic is not a fallback. Job 335 asked for Automatic, ran its first
  choice (DeepSeek), and the button told the editor "it fell back" -- words about
  a move no failover note and no preflight record ever made. The distinction the
  label has to keep is between a MODEL that changed and a CHOICE that resolved:
  "Automatic" is the second, so it never earns the fallback clause.
*/
describe("modelAndResearchLabel: Automatic does not say it fell back", () => {
  it("names the Automatic pick with no fallback clause when its first choice wrote the draft", () => {
    assert.equal(
      modelAndResearchLabel({
        runningLine: "",
        pickerModel: "Automatic",
        requestedModelChoice: "auto",
        requestedModel: "Automatic",
        writerModel: "DeepSeek v4.1 Flash 1017",
      }),
      "DeepSeek v4.1 Flash 1017 (you picked Automatic)",
    );
  });

  it("still says the explicit pick fell back when a different model wrote", () => {
    assert.equal(
      modelAndResearchLabel({
        runningLine: "",
        pickerModel: "Claude Sonnet 5.5",
        requestedModelChoice: "claude-sonnet",
        requestedModel: "Claude Sonnet 5.5",
        writerModel: "DeepSeek v4.1 Flash 1017",
      }),
      "DeepSeek v4.1 Flash 1017 (you picked Claude Sonnet 5.5; it fell back)",
    );
  });

  it("returns the writer alone when the requested choice is the writer", () => {
    assert.equal(
      modelAndResearchLabel({
        runningLine: "",
        pickerModel: "DeepSeek v4.1 Flash 1017",
        requestedModelChoice: "deepseek-flash",
        requestedModel: "DeepSeek v4.1 Flash 1017",
        writerModel: "DeepSeek v4.1 Flash 1017",
      }),
      "DeepSeek v4.1 Flash 1017",
    );
  });
});

// DHK-1: the "Last draft" model is the model that finished the draft. A failover
// note names that model; with no note, the receipt's recorded runtime does; with
// neither (a legacy job with null runtime fields), the line prints the time only.
describe("lastDraftInHand: the model that finished the draft (DHK-1)", () => {
  const finishedAt = "2026-10-12T16:53:00.000Z";
  const now = new Date("2026-10-12T20:00:00.000Z");
  const when = lastDraftWhen(finishedAt, now);
  it("names the failover destination when the job moved to another model and the receipt records no runtime", () => {
    assert.equal(
      lastDraftInHand({
        hasDraft: true, civicReporting: false, jobStatus: "completed", modelLabel: "", now, finishedAt,
        failoverNote: "This draft moved to Codex Terra because Codex Sol 6.1 timed out.",
      }),
      `Last draft: Codex Terra, ${when}`,
    );
  });
  it("names the last destination of a failover trail, not the model the job picked", () => {
    assert.equal(
      lastDraftInHand({
        hasDraft: true, civicReporting: false, jobStatus: "completed", modelLabel: "Codex Sol 6.1 (balanced)", now, finishedAt,
        failoverNote: "Codex Sol 6.1 timed out → DeepSeek v4.1 was unavailable → Codex Terra",
      }),
      `Last draft: Codex Terra, ${when}`,
    );
  });
  it("prints the time only when the desk records no finishing model (null runtime, no switch)", () => {
    assert.equal(
      lastDraftInHand({ hasDraft: true, civicReporting: false, jobStatus: "completed", modelLabel: "", failoverNote: null, now, finishedAt }),
      `Last draft: ${when}`,
    );
  });
  it("keeps the recorded runtime's name when the job did not switch", () => {
    assert.equal(
      lastDraftInHand({ hasDraft: true, civicReporting: false, jobStatus: "completed", modelLabel: "Codex Sol 6.1 (balanced)", failoverNote: null, now, finishedAt }),
      `Last draft: Codex Sol 6.1 (balanced), ${when}`,
    );
  });
  it("reads the recorded runtime from a job receipt, and nothing from a receipt without one", () => {
    assert.equal(recordedRuntime(JSON.stringify({ actualRuntime: "codex-sol-balanced" })), "codex-sol-balanced");
    assert.equal(recordedRuntime("{}"), null);
    assert.equal(recordedRuntime(null), null);
    assert.equal(recordedRuntime("not json"), null);
  });
});

describe("the Last draft line names the model that ran (the story page's composition)", () => {
  const finishedAt = "2026-09-10T16:53:00.000Z";
  const lastDraftFor = (choice: string, resultJson: string | null, choiceLabel: string) =>
    lastDraftInHand({
      hasDraft: true,
      civicReporting: false,
      jobStatus: "completed",
      modelLabel: pastRunModelName({ choice, actualModelId: recordedActualModelId(resultJson), choiceLabel }),
      finishedAt,
    });
  it("names an old claude-frontier draft without a version when its receipt recorded no model", () => {
    assert.match(
      lastDraftFor("claude-frontier", JSON.stringify({ checkpointDraftId: 100 }), "Claude Opus 5.5"),
      /^Last draft: Claude Opus, /,
    );
  });
  it("names the recorded model with its version when the receipt recorded a known id", () => {
    assert.match(
      lastDraftFor("claude-frontier", JSON.stringify({ actualModelId: "claude-opus-5-5" }), "Claude Opus 5.5"),
      /^Last draft: Claude Opus 5\.5, /,
    );
  });
  it("names an unknown recorded model id as the raw id", () => {
    assert.match(
      lastDraftFor("claude-frontier", JSON.stringify({ actualModelId: "claude-opus-5" }), "Claude Opus 5.5"),
      /^Last draft: claude-opus-5, /,
    );
  });
});

describe("a saved draft's 'you picked' names the pick as its run recorded it", () => {
  const failoverNote = "Claude Opus request timed out. -> DeepSeek v4.1 Flash 1017";
  const writerOf = (choice: string, resultJson: string | null, choiceLabel: string) =>
    pastRunModelName({ choice, actualModelId: recordedActualModelId(resultJson), choiceLabel });
  it("an old claude-frontier job with no recorded id says 'You picked Claude Opus', with no version", () => {
    const resultJson = JSON.stringify({ requestedRuntime: "claude-frontier" });
    const pick = pastDraftPickName({ status: "completed", requestedChoice: "claude-frontier", ranChoice: "deepseek-flash", resultJson, choiceLabel: "Claude Opus 5.5" });
    const writer = writerOf("deepseek-flash", resultJson, "DeepSeek v4.1 Flash 1017");
    assert.equal(pick, "Claude Opus");
    assert.equal(
      draftFallbackAttribution({ pickedModel: pick, writerModel: writer, failoverNote }),
      "You picked Claude Opus. DeepSeek v4.1 Flash 1017 wrote this draft because Claude Opus timed out.",
    );
    assert.equal(
      modelAndResearchLabel({ runningLine: "", pickerModel: "Claude Opus 5.5", pickerModelChoice: "claude-frontier", requestedModelChoice: "claude-frontier", requestedModel: pick, writerModel: writer }),
      "DeepSeek v4.1 Flash 1017 (you picked Claude Opus; it fell back)",
    );
  });
  it("an old claude-frontier job that ran unchanged names no version and adds no attribution sentence", () => {
    const resultJson = JSON.stringify({ checkpointDraftId: 100 });
    const pick = pastDraftPickName({ status: "completed", requestedChoice: "claude-frontier", ranChoice: "claude-frontier", resultJson, choiceLabel: "Claude Opus 5.5" });
    const writer = writerOf("claude-frontier", resultJson, "Claude Opus 5.5");
    assert.equal(draftFallbackAttribution({ pickedModel: pick, writerModel: writer, failoverNote }), undefined);
    assert.equal(
      modelAndResearchLabel({ runningLine: "", pickerModel: "Claude Opus 5.5", pickerModelChoice: "claude-frontier", requestedModelChoice: "claude-frontier", requestedModel: pick, writerModel: writer }),
      "Claude Opus",
    );
  });
  it("a new deepseek-flash job that recorded its model and ran its pick adds no attribution sentence", () => {
    const resultJson = JSON.stringify({ actualModelId: "deepseek-v4.1-flash" });
    const pick = pastDraftPickName({ status: "completed", requestedChoice: "deepseek-flash", ranChoice: "deepseek-flash", resultJson, choiceLabel: "DeepSeek v4.1 Flash 1017" });
    const writer = writerOf("deepseek-flash", resultJson, "DeepSeek v4.1 Flash 1017");
    assert.equal(pick, "DeepSeek v4.1 Flash 1017");
    assert.equal(draftFallbackAttribution({ pickedModel: pick, writerModel: writer, failoverNote: null }), undefined);
  });
  it("a live job keeps today's label for its pick", () => {
    const resultJson = JSON.stringify({ actualModelId: "claude-opus-5-5" });
    assert.equal(pastDraftPickName({ status: "running", requestedChoice: "claude-frontier", ranChoice: "claude-frontier", resultJson, choiceLabel: "Claude Opus 5.5" }), "Claude Opus 5.5");
    assert.equal(pastDraftPickName({ status: undefined, requestedChoice: "", ranChoice: undefined, resultJson: null, choiceLabel: "Automatic" }), "Automatic");
  });
  it("a picker that moved to another model still shows the picker", () => {
    assert.equal(
      modelAndResearchLabel({ runningLine: "", pickerModel: "DeepSeek v4.1 Flash 1017", pickerModelChoice: "deepseek-flash", requestedModelChoice: "claude-frontier", requestedModel: "Claude Opus", writerModel: "Claude Opus" }),
      "DeepSeek v4.1 Flash 1017",
    );
  });
});

/*
  A3: a writer fallback is not a model move. The news skill's fallback writes
  its sentence into `failover_note` too, and the button used to read ANY note
  as a switch -- "Switched to another model…" while the SAME model wrote the
  story -- and the note line called it "Model note:".
*/
describe("a writer fallback is not a model move", () => {
  const fallback =
    "The research writer could not finish (The writer finished without a story). The story is being written the usual way, on the same model.";

  it("names the model a real move note moved to", () => {
    assert.equal(
      modelMoveFromNote("This draft moved to Codex Sol 6.1 (balanced) because Gemini timed out."),
      "Codex Sol 6.1 (balanced)",
    );
  });

  it("returns undefined for the writer fallback sentence", () => {
    assert.equal(modelMoveFromNote(fallback), undefined);
    assert.equal(modelMoveFromNote(null), undefined);
  });

  it("keeps the ordinary drafting label on a fallback", () => {
    // The old inline rule printed `Switched to … ?? "another model"` for any note.
    assert.equal(
      workingLabelText({ state: "running", failoverNote: fallback, hasBody: false }),
      "Drafting…",
    );
    assert.equal(
      workingLabelText({ state: "running", failoverNote: fallback, hasBody: true }),
      "Redrafting…",
    );
  });

  it("still shows the switch on a real move", () => {
    assert.equal(
      workingLabelText({
        state: "running",
        failoverNote: "This draft moved to Codex Sol 6.1 (balanced) because Gemini timed out.",
        hasBody: false,
      }),
      "Switched to Codex Sol 6.1 (balanced)…",
    );
  });

  it("labels the note by what it says", () => {
    assert.equal(writerNoteLabel("This draft moved to Gemini Flash because Codex returned nothing."), "Model note:");
    assert.equal(writerNoteLabel(fallback), "Writer note:");
  });
});

/*
  R2-UX-1 (D241): a draft job never stores the sentence -- `setJobFailoverNote`
  writes the trail `appendStoryFailoverNote` builds ("<reason> → <label>"). The
  bar read only the sentence, so a REAL move was labeled "Writer note:" and the
  running button said "Drafting…" instead of "Switched to <model>…".
*/
describe("a draft's real failover trail reads as a model move", () => {
  const fallback =
    "The research writer could not finish (The writer finished without a story). The story is being written the usual way, on the same model.";
  const oneMove = appendStoryFailoverNote(
    "",
    failoverNoteSentence("Codex Sol 6.1", "Gemini 3.8 Flash", "timeout"),
  );

  it("names the destination of a one-hop trail", () => {
    assert.equal(modelMoveFromNote(oneMove), "Codex Sol 6.1");
    assert.equal(writerNoteLabel(oneMove), "Model note:");
    assert.equal(
      workingLabelText({ state: "running", failoverNote: oneMove, hasBody: false }),
      "Switched to Codex Sol 6.1…",
    );
  });

  it("is not a move when the note is only the writer fallback sentence", () => {
    assert.equal(modelMoveFromNote(fallback), undefined);
    assert.equal(writerNoteLabel(fallback), "Writer note:");
    assert.equal(
      workingLabelText({ state: "running", failoverNote: fallback, hasBody: false }),
      "Drafting…",
    );
  });

  it("names the move that follows the fallback sentence", () => {
    const note = appendStoryFailoverNote(
      fallback,
      failoverNoteSentence("Codex Sol 6.1", "Gemini 3.8 Flash", "quota"),
    );
    assert.equal(modelMoveFromNote(note), "Codex Sol 6.1");
    assert.equal(writerNoteLabel(note), "Model note:");
  });

  /*
    The fallback sentence carries the skill's own error text inside its
    parentheses, and an error text can hold an arrow. The trail's separator is
    an arrow too, so an arrow inside the sentence used to cut the sentence in
    two and the tail of it read as a model name: "Switched to ..." for a draft
    that never moved.
  */
  for (const arrow of ["->", "→"] as const) {
    it(`keeps a fallback sentence whole when its reason holds "${arrow}"`, () => {
      const odd = `The research writer could not finish (step 2 ${arrow} step 3 failed). The story is being written the usual way, on the same model.`;
      assert.equal(appendStoryFailoverNote("", odd), odd);
      assert.equal(modelMoveFromNote(odd), undefined);
      assert.equal(writerNoteLabel(odd), "Writer note:");
      assert.equal(
        workingLabelText({ state: "running", failoverNote: odd, hasBody: false }),
        "Drafting…",
      );
      assert.equal(failoverDestinationFromNote(odd), undefined);
    });
  }

  it("still names the real move that follows a fallback sentence whose reason holds an arrow", () => {
    const odd =
      "The research writer could not finish (step 2 -> step 3 failed). The story is being written the usual way, on the same model.";
    const move = failoverNoteSentence("Codex Sol 6.1", "Gemini 3.8 Flash", "quota");
    const note = appendStoryFailoverNote(odd, move);
    const plainNote = appendStoryFailoverNote(fallback, move);
    assert.equal(modelMoveFromNote(note), "Codex Sol 6.1");
    assert.equal(failoverDestinationFromNote(note), "Codex Sol 6.1");
    assert.equal(switchReasonFromNote(note), switchReasonFromNote(plainNote));
  });
});
