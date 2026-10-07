import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DARK_AUTOMATIC_LADDER,
  DEFAULT_OPINION_MODEL,
  effectiveStoryModelChoice,
  darkModelChoice,
  localModelOptionLabel,
  modelChoiceLabel,
  modelChoiceHelp,
  OPINION_MODEL_CHOICES,
  FORCED_MODEL_CHOICES,
  opinionModelChoice,
  opinionProviderProblem,
  PICKER_OPTION_TEXT_MAX,
  pickerOptionText,
  pickerOptionTitle,
  rememberedStoryModelChoice,
  retiredModelChoiceNote,
  STORY_MODEL_CHOICES,
  storyModelChoice,
  shouldHydrateDarkModel,
} from "./model-choice.ts";
import { LOCAL_MODEL_UNCONFIGURED } from "./preflight.ts";
import { isOfferedForJob, jobModelOptions } from "./model-assignments.ts";
import { RETIRED_PROVIDER_IDS, automaticLadder, providersFor } from "./provider-registry.ts";

const STORY_VALUES = [
  "auto",
  "codex-astra",
  "codex-frontier",
  "codex-balanced",
  "codex-luna",
  "claude-fable",
  "claude-frontier",
  "claude-sonnet",
  "claude-haiku",
  "local-model",
] as const;

/**
 * Automatic's own rungs: not options in any menu, but valid on a job row
 * (0.6.63, Unit Y item 1). A job Automatic pinned to one has to keep it.
 */
const RUNG_VALUES = ["deepseek-flash", "qwen-local"] as const;

describe("model choice contract", () => {
  it("offers every named subscription model in the shared Story picker", () => {
    assert.deepEqual(
      STORY_MODEL_CHOICES.map((choice) => choice.label),
      [
        "Automatic",
        "Codex Astra",
        "Codex Sol",
        "Codex Terra",
        "Codex Luna",
        "Claude Fable",
        "Claude Opus",
        "Claude Sonnet",
        "Claude Haiku",
        "Local model",
      ],
    );
  });
  it("runs Automatic on DeepSeek, then Qwen, then Codex Terra", () => {
    assert.deepEqual([...automaticLadder()], [
      "deepseek-flash",
      "qwen-local",
      "codex-balanced",
    ]);
    // Claude Sonnet left the ladder in 0.6.63 (Unit Y item 1) and is a hand
    // pick only; the frontier Codex stays off it as it always has.
    assert.ok(!automaticLadder().includes("claude-sonnet"));
    assert.ok(!automaticLadder().includes("codex-frontier"));
  });
  it("never converts a missing or malformed custom connection into Automatic", () => {
    for (const value of ["custom:", "custom:deleted", "custom:untrusted/input"]) {
      for (const normalize of [storyModelChoice, opinionModelChoice, darkModelChoice]) {
        assert.equal(normalize(value), value);
      }
    }
  });
  it("preserves an explicit saved API connection in every workflow without changing built-in choices", () => {
    const choice = "custom:2ff67746-9c53-465d-9d63-fb96a7ec1175";
    for (const normalize of [
      storyModelChoice,
      opinionModelChoice,
      darkModelChoice,
      effectiveStoryModelChoice,
    ]) {
      assert.equal(normalize(choice), choice);
    }
    assert.match(modelChoiceLabel(choice), /custom api/i);
    assert.match(modelChoiceHelp(choice), /technical failure/i);
    assert.doesNotMatch(modelChoiceHelp(choice), /tries Claude/);
    assert.deepEqual(
      STORY_MODEL_CHOICES.map((option) => option.value),
      STORY_VALUES,
    );
  });
  it("ignores stale Dark Desk detail, then hydrates when the selected file's detail arrives", () => {
    assert.equal(shouldHydrateDarkModel(8, 7, "codex-balanced", "briefed"), false);
    assert.equal(shouldHydrateDarkModel(8, 8, null, "investigating"), false);
    assert.equal(shouldHydrateDarkModel(8, 8, "codex-balanced", "investigating"), true);
    assert.equal(shouldHydrateDarkModel(8, 8, null, "briefed"), true);
  });

  it("keeps unique Story values in the intended order with Automatic first", () => {
    const values = STORY_MODEL_CHOICES.map((choice) => choice.value);
    assert.deepEqual(values, STORY_VALUES);
    assert.equal(new Set(values).size, values.length);
    assert.equal(STORY_MODEL_CHOICES[0].label, "Automatic");
    assert.match(STORY_MODEL_CHOICES[0].detail, /recommended/i);
  });

  /*
    UNIT U29 -- OPINION'S PICKER NAMES DEEPSEEK.

    The owner's decision of 2026-09-30 ("use deepseek ... keep the picker
    regardless") made DeepSeek v4.1 Flash Opinion's first Automatic rung and a
    nameable choice there. The picker is otherwise the Story list exactly as it
    was, and this pins both halves: every Story choice is still offered on
    Opinion, and the ONE addition is the rung -- nothing else moved.
  */
  it("offers every Story choice on Opinion, plus the DeepSeek rung by name", () => {
    const opinionValues = OPINION_MODEL_CHOICES.map((choice) => choice.value);
    assert.deepEqual(opinionValues, [...STORY_VALUES, "deepseek-flash"]);
    assert.deepEqual(
      opinionValues.filter((value) => value !== "deepseek-flash"),
      STORY_MODEL_CHOICES.map((choice) => choice.value),
      "Opinion must not lose a single choice Story offers",
    );
    // And it is offered on Opinion ONLY: Story's own menu still reaches
    // DeepSeek the way it always has, through Automatic.
    assert.ok(!STORY_MODEL_CHOICES.some((choice) => choice.value === "deepseek-flash"));
    assert.ok(!providersFor("dark").some((entry) => entry.id === "deepseek-flash"));
    assert.ok(!providersFor("forced").some((entry) => entry.id === "deepseek-flash"));

    const deepseek = OPINION_MODEL_CHOICES.find((choice) => choice.value === "deepseek-flash")!;
    assert.equal(deepseek.label, "DeepSeek v4.1 Flash");
    assert.equal(pickerOptionText(deepseek), "DeepSeek v4.1 Flash — Ollama");
    assert.ok(
      pickerOptionText(deepseek).length <= PICKER_OPTION_TEXT_MAX,
      "the option must fit the measured select box",
    );
    assert.match(pickerOptionTitle(deepseek), /research and drafting/);
    // A pick that says DeepSeek says DeepSeek back: not Automatic, and not the
    // page default Codex Sol.
    assert.equal(opinionModelChoice("deepseek-flash"), "deepseek-flash");
    assert.equal(modelChoiceLabel("deepseek-flash", "opinion"), "DeepSeek v4.1 Flash");
    assert.match(modelChoiceHelp("deepseek-flash", "opinion"), /Prefers DeepSeek v4\.1 Flash/);
  });

  /*
    Unit U29: the editor is told BEFORE the run that a DeepSeek editorial is
    written in one call from the material they supplied. Unit U30 kept the
    "no web search of its own" half and replaced the "no gathering pass ran"
    half: the desk now researches for it, and the sentence says so. The
    sentence is read from the same registry answer the pair dispatch turns on
    (`providerRunsToolPass`), so it cannot describe a flow the desk does not
    run.
  */
  it("says a no-web-tools pick is researched by the desk, and says it only where that is true", () => {
    const help = modelChoiceHelp("deepseek-flash", "opinion");
    assert.match(help, /no web search of its own/);
    assert.match(help, /the desk searches and reads the sources for it/);
    assert.doesNotMatch(help, /no gathering pass runs/, "the desk researches for this writer now");

    // The two CLIs DO run their own gathering pass, so their help says nothing
    // of the sort -- read from their registry kind, not from a list of ids.
    for (const choice of ["claude-frontier", "codex-frontier"] as const) {
      const cliHelp = modelChoiceHelp(choice, "opinion");
      assert.match(cliHelp, /Prefers/);
      assert.doesNotMatch(cliHelp, /the desk searches and reads the sources for it/, choice);
    }
  });

  /*
    The Models screen's "Assign models to jobs" row for Opinion draws its menu
    from this same list (`jobModelOptions("opinion")` in ./model-assignments.ts),
    so DeepSeek being here is what makes it selectable there.
  */
  it("is selectable as Opinion's assignment in the Models screen", () => {
    assert.ok(jobModelOptions("opinion").some((option) => option.value === "deepseek-flash"));
    assert.ok(isOfferedForJob("opinion", "deepseek-flash"));
    // A forced job's menu is a different list on purpose: a run that must name
    // ONE runtime up front may not name a rung.
    assert.ok(!isOfferedForJob("story-draft", "deepseek-flash"));
    assert.ok(!isOfferedForJob("ocr", "deepseek-flash"));
  });

  /*
    UNIT U29b -- OPINION OPENS ON AUTOMATIC.

    The owner's decision D18d was "use deepseek ... keep the picker
    regardless". Unit U29 made DeepSeek the ladder's first rung; U29b makes
    Automatic the page's default, so the decision reaches the editor who never
    touches the picker instead of only the one who opens it.

    The other half of the same test is the half that must NOT change: an
    editor's own saved choice is honoured exactly as it was.
  */
  it("defaults Opinion to Automatic, and still honours an editor's own pick", () => {
    assert.equal(DEFAULT_OPINION_MODEL, "auto");
    // "Nobody has chosen" -- an omitted field from the client, or a stored id
    // this build cannot read -- means Automatic, not a pinned model.
    assert.equal(opinionModelChoice(undefined), "auto");
    assert.equal(opinionModelChoice(null), "auto");
    assert.equal(opinionModelChoice(""), "auto");
    assert.equal(opinionModelChoice("not-a-model"), "auto");
    assert.equal(opinionModelChoice("qwen-local"), "auto", "the LM Studio rung is not an Opinion pick");
    // ...and every real pick survives, including the rung Opinion names.
    for (const choice of OPINION_MODEL_CHOICES) {
      assert.equal(opinionModelChoice(choice.value), choice.value, `${choice.value} must load as itself`);
    }
    assert.equal(opinionModelChoice("codex-frontier"), "codex-frontier");
    assert.equal(
      modelChoiceLabel(opinionModelChoice("codex-frontier"), "opinion"),
      "Codex Sol",
      "a saved explicit Codex choice still loads as Codex",
    );
    // Story and Scan already default this way; Opinion agreeing is the point.
    assert.equal(STORY_MODEL_CHOICES[0]?.value, "auto");
    assert.equal(OPINION_MODEL_CHOICES[0]?.value, "auto");
  });

  it("derives the forced list from its registry and offers Automatic first", () => {
    assert.deepEqual(
      FORCED_MODEL_CHOICES.slice(1).map((choice) => choice.value),
      providersFor("forced").map((entry) => entry.id),
    );
    assert.equal(FORCED_MODEL_CHOICES[0]?.value, "auto");
    assert.equal(modelChoiceLabel("codex-balanced", "forced"), "Codex Terra");
  });

  it("round-trips every valid Story choice and defaults invalid input safely", () => {
    for (const value of [...STORY_VALUES, ...RUNG_VALUES]) {
      assert.equal(storyModelChoice(value), value);
    }
    for (const invalid of [undefined, null, "", "codex", "local; rm", 0, {}, []]) {
      assert.equal(storyModelChoice(invalid), "auto");
    }
  });

  it("labels a pinned rung by the registry name the editor reads", () => {
    // "Automatic" would be a lie on the line the editor reads to find out.
    assert.equal(modelChoiceLabel("deepseek-flash"), "DeepSeek v4.1 Flash");
    /*
      0.6.69 (Unit AL item 4): the LM Studio rung names no model of its own --
      it runs whatever is loaded -- so its label is the bare "Local model".
      The model that actually wrote the draft reaches the page from the probe
      and the job receipt instead, as "Local model (<name>)".
    */
    assert.equal(modelChoiceLabel("qwen-local"), "Local model");
  });

  it("falls a stored Grok choice back to Automatic and says the provider was removed", () => {
    /*
      GR-C removed Grok (xAI) as a provider. A row stored by an older build
      still holds the id, and it must keep LOADING -- as Automatic, with the
      note that says why. The note no longer mentions a sign-in, because there
      is no sign-in: the connection and its transport are gone.
    */
    assert.equal(modelChoiceLabel("grok-oauth"), "Automatic");
    assert.equal(storyModelChoice("grok-oauth"), "auto");
    /*
      Unit U29b: all three normalisers now answer the same thing for a value
      nobody can read. Opinion used to fall to a pinned Codex Sol, so a stored
      id from an older build spent on the frontier model without anyone
      choosing it; Automatic is what the desk would have run anyway.
    */
    assert.equal(opinionModelChoice("grok-oauth"), "auto");
    assert.equal(darkModelChoice("grok-oauth"), "auto");
    assert.equal(
      retiredModelChoiceNote("grok-oauth"),
      "Grok (SuperGrok) has been removed from TownReporter, so this falls back to Automatic. Choose another model on the Models screen.",
    );
    // Every id on the retired list gets the same note, so a future retirement
    // does not need this function edited again.
    for (const value of RETIRED_PROVIDER_IDS) assert.ok(retiredModelChoiceNote(value));
    for (const value of [...STORY_VALUES, ...RUNG_VALUES, undefined, null, "custom:x"]) {
      assert.equal(retiredModelChoiceNote(value), null);
    }
    // Retired means retired: no menu offers it on any surface.
    for (const surface of ["story", "scan", "follow-up", "opinion", "dark", "ocr", "forced"] as const) {
      assert.ok(!providersFor(surface).some((entry) => entry.id === "grok-oauth"));
    }
  });

  it("normalises stored 'local' and 'zen' choices (from old jobs) to Automatic", () => {
    // Zen and Local Qwen were removed from the picker 2026-09-02. A job queued
    // before the removal can still have "local" or "zen" persisted for it; that
    // must fall back to Automatic exactly like any other unrecognized value.
    assert.equal(storyModelChoice("local"), "auto");
    assert.equal(storyModelChoice("zen"), "auto");
  });

  it("preserves Automatic's configured-gateway selection for the whole queued run", () => {
    assert.equal(effectiveStoryModelChoice("configured"), "configured");
    assert.equal(effectiveStoryModelChoice("codex-balanced"), "codex-balanced");
    assert.equal(effectiveStoryModelChoice("not-a-provider"), "auto");
    assert.equal(modelChoiceLabel("configured"), "Configured gateway");
  });

  it("restores the editor's visible Story choice from the latest job", () => {
    assert.equal(rememberedStoryModelChoice("claude-frontier", "auto"), "auto");
    assert.equal(rememberedStoryModelChoice("codex-frontier", "editor"), "codex-frontier");
    assert.equal(rememberedStoryModelChoice("local-model", "editor"), "local-model");
  });

  it("round-trips Opinion choices and defaults missing or invalid input to Automatic", () => {
    for (const value of [
      "auto",
      "claude-frontier",
      "codex-balanced",
      "codex-frontier",
      "local-model",
      "deepseek-flash",
    ] as const) {
      assert.equal(opinionModelChoice(value), value);
    }
    for (const invalid of ["local", "zen", "codex", "grok-oauth", undefined, null, {}]) {
      assert.equal(opinionModelChoice(invalid), "auto");
    }
  });

  it("maps every valid value to its visible label and invalid input to Automatic", () => {
    for (const choice of STORY_MODEL_CHOICES) {
      assert.equal(modelChoiceLabel(choice.value), choice.label);
    }
    assert.equal(modelChoiceLabel("not-a-model"), "Automatic");
    assert.equal(modelChoiceLabel(undefined), "Automatic");
  });

  it("explains each automatic order and technical fallback for explicit choices", () => {
    assert.equal(
      modelChoiceHelp("auto"),
      "Uses your configured gateway when set; otherwise tries DeepSeek v4.1 Flash, Local model, then Codex Terra. A model on this computer is used only when it is already loaded. The desk writes with whichever one is loaded. If the first provider reaches a usage limit, becomes unavailable, loses its login, or does not respond in time, the unfinished call moves to the next. A content refusal stops the run.",
    );
    assert.equal(
      modelChoiceHelp("auto", "opinion"),
      "Tries DeepSeek v4.1 Flash, Codex Sol, then Claude Sonnet. If one reaches a usage limit or has a technical failure, the editorial moves to the next ready provider. A provider refusal stops the run.",
    );
    /*
      0.6.63 (Unit Y item 1). Dark Desk's Automatic ladder used to be a typed
      out Terra -> Sonnet tuple, so the owner's "DeepSeek first for research"
      decision did not reach the surface that does the most research. It is the
      registry ladder now, and this sentence is read from it -- including the
      half-line that says a rung on this computer is used only when it is
      already loaded.
    */
    assert.equal(
      modelChoiceHelp("auto", "dark"),
      "Uses your configured gateway when set; otherwise tries DeepSeek v4.1 Flash, Local model, then Codex Terra. A model on this computer is used only when it is already loaded. The desk writes with whichever one is loaded. Planning uses the selected provider's faster planning model. If the first provider's login has lapsed or synthesis does not respond in time, only the unfinished stage moves to the next provider.",
    );
    assert.equal(
      modelChoiceHelp("codex-frontier"),
      "Prefers Codex Sol for this run. If it has a technical failure, the unfinished call can move to the next ready writing model; a content refusal stops the run.",
    );
  });

  it("tells the daily-scan picker what Automatic does for a scheduled run", () => {
    /*
      0.6.64 (Unit AA) item 2. The Scan picker now OFFERS Automatic, so the
      sentence under it has to describe what a scheduled run actually does.
      It cannot be Story's: a scheduled run stores the model it will run on in
      its reservation and run record BEFORE the job is queued, so it pins one
      rung instead of leaving "your configured gateway" to be read at call
      time. Read from the same ladder sentence every other surface uses, so a
      reordered or retired rung cannot leave this wording behind.
    */
    const help = modelChoiceHelp("auto", "scan");
    assert.match(help, /DeepSeek v4\.1 Flash, Local model, then Codex Terra/);
    assert.match(help, /records which one ran/i);
    assert.doesNotMatch(help, /configured gateway/i);
    /*
      The select's own line is unchanged: it is the measured 30-character
      "Automatic — Recommended ladder" (Unit P item 7 -- a longer line is
      clipped on the control that decides what a run spends), and the ladder
      it means stays reachable as the option's title.
    */
    const automatic = STORY_MODEL_CHOICES.find((choice) => choice.value === "auto");
    assert.ok(automatic, "the story/scan list must offer Automatic");
    assert.ok(pickerOptionText(automatic!).length <= PICKER_OPTION_TEXT_MAX);
    assert.match(
      pickerOptionTitle(automatic!),
      /DeepSeek v4\.1 Flash, Local model, then Codex Terra/,
    );
  });

  it("walks Dark Desk's Automatic down the same ladder as Story and Scan", () => {
    /*
      0.6.63, Unit Y item 1: "Ladder for every Automatic surface that drafts or
      researches ... Dark Desk". Dark's ladder is derived, not typed out, so a
      rung added, removed or reordered for Story cannot leave Dark Desk -- or
      `probeDarkProvider`'s loop, which spreads this list -- describing a
      different order.
    */
    assert.deepEqual(
      [...DARK_AUTOMATIC_LADDER],
      [...automaticLadder()],
      "Dark Desk's Automatic ladder must be the registry's, in order",
    );
    assert.equal(DARK_AUTOMATIC_LADDER[0], "deepseek-flash");
  });

  it("names the local model in every picker and says an unavailable selection stops", () => {
    assert.equal(modelChoiceLabel("local-model"), "Local model");
    assert.equal(
      modelChoiceHelp("local-model"),
      "Uses the selected Ollama or on-device model for this run. If it is unavailable, the run stops instead of silently switching providers.",
    );
    assert.equal(
      modelChoiceHelp("local-model", "opinion"),
      "Uses the selected Ollama or on-device model for this run. If it is unavailable, the run stops instead of silently switching providers.",
    );
    assert.equal(
      modelChoiceHelp("local-model", "dark"),
      "Uses the selected Ollama or on-device model for this run. If it is unavailable, the run stops instead of silently switching providers.",
    );
  });

  it("no longer names SuperGrok as a writing model in any picker", () => {
    // Retired 0.6.63, Unit Y item 4. A stored choice reads as Automatic and
    // the help says why, rather than describing a provider the menu dropped.
    for (const surface of [undefined, "opinion", "dark"] as const) {
      const help = modelChoiceHelp("grok-oauth", surface);
      assert.doesNotMatch(help, /Prefers Grok/);
    }
    assert.match(modelChoiceHelp("grok-oauth"), /^Uses your configured gateway/);
  });

  it("gives Opinion setup steps for its one provider, and does not send anyone to Codex", () => {
    const guidance = opinionProviderProblem(
      "AI is not available. Set ANTHROPIC_API_KEY, XAI_API_KEY, or LLM_BASE_URL.",
    );
    assert.doesNotMatch(guidance, /Codex/);
    assert.match(guidance, /Claude Code/);
    assert.doesNotMatch(guidance, /ANTHROPIC_API_KEY/);
    assert.doesNotMatch(guidance, /set .*XAI_API_KEY|set .*LLM_BASE_URL/i);
  });

  it("gives an unconfigured Local model pick the same single local-specific message preflight uses", () => {
    const guidance = opinionProviderProblem(
      "AI is not available. Set ANTHROPIC_API_KEY, XAI_API_KEY, or LLM_BASE_URL.",
      "local-model",
    );
    assert.equal(guidance, LOCAL_MODEL_UNCONFIGURED);
    assert.match(guidance, /Start LM Studio's local server or Ollama/);
    assert.match(guidance, /click Refresh/);
    assert.doesNotMatch(guidance, /set LLM_MODEL/);
    assert.doesNotMatch(guidance, /Claude Code/);
  });
});

describe("localModelOptionLabel", () => {
  it("appends ' · vision' for a vision-capable model, alongside loaded/thinking", () => {
    assert.equal(
      localModelOptionLabel({ id: "qwen2.5vl-7b", loaded: true, thinking: false, vision: true }),
      "qwen2.5vl-7b · loaded · vision",
    );
  });

  it("shows the bare id when nothing else applies", () => {
    assert.equal(
      localModelOptionLabel({ id: "gemma4:12b", loaded: null, thinking: false, vision: false }),
      "gemma4:12b",
    );
  });

  it("never claims vision for a plain chat model", () => {
    const label = localModelOptionLabel({
      id: "gemma4:12b",
      loaded: true,
      thinking: true,
      vision: false,
    });
    assert.doesNotMatch(label, /vision/);
    assert.equal(label, "gemma4:12b · loaded · thinking off");
  });

  it("labels hosted Ollama models and their large context window", () => {
    assert.equal(
      localModelOptionLabel({
        id: "deepseek-v4.1-flash:cloud",
        loaded: null,
        thinking: true,
        vision: true,
        cloud: true,
        contextLength: 1_048_576,
      }),
      "deepseek-v4.1-flash:cloud · Ollama Cloud · 1M context · thinking off · vision",
    );
  });
});

/*
  0.6.63 (Unit Y item 5). The Server page's Writing models panel has to say
  the order in plain words, and it reads the sentence from here so the panel
  cannot describe a ladder the desk no longer has. The word "Qwen" is the
  owner's -- plain rather than the picker's full model id -- because what the
  operator has to check is that a Qwen is LOADED on this machine, not which
  version number the label carries.

  Imported through a variable on purpose: the test runner loads this file
  whole, so a name that does not exist yet would fail every test in it rather
  than the one that is actually red.
*/
const ORDER_MODULE = "./model-choice.ts";

async function orderSentenceFn(): Promise<(ladder?: readonly string[]) => string> {
  const module = (await import(ORDER_MODULE)) as unknown as Record<string, unknown>;
  const fn = module.automaticOrderSentence;
  assert.equal(typeof fn, "function", "model-choice.ts must export automaticOrderSentence");
  return fn as (ladder?: readonly string[]) => string;
}

describe("the Writing models panel's ladder sentence", () => {
  it("says the order in plain words, first to last", async () => {
    const sentence = await orderSentenceFn();
    assert.equal(
      sentence(),
      "Automatic uses DeepSeek v4.1 Flash first, then the model on this computer if it is loaded, then Codex Terra.",
    );
  });

  it("follows the ladder it is given, and says so when there is none", async () => {
    const sentence = await orderSentenceFn();
    assert.equal(sentence(["codex-balanced"]), "Automatic uses Codex Terra.");
    assert.equal(
      sentence(["codex-balanced", "deepseek-flash"]),
      "Automatic uses Codex Terra first, then DeepSeek v4.1 Flash.",
    );
    assert.equal(sentence([]), "Automatic has no writing model set up on this machine.");
  });
});
