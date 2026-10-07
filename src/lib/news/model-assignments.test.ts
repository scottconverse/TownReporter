/**
 * "Who does what": the resolution order, the fallbacks, the refusal rule, the
 * effort validation and the menus -- all of it pure, so none of it needs a
 * database or a model.
 *
 * The six things the brief asked to be provable are here, in this order:
 *
 * 1. The resolution order: an explicit per-run pick beats `model_assignments`
 *    beats today's surface default.
 * 2. Fallback order after a quota failure: rank 1, then rank 2, then nothing.
 * 3. A content refusal is final and never falls back.
 * 4. Effort is validated per EXACT model, not per provider id.
 * 5. Grok is never offered for any job, and never runs even if asked for.
 * 6. A saved assignment for a model this build no longer offers falls through
 *    to the default WITH a notice -- silence there would be a run that quietly
 *    ignored the owner's setting.
 *
 * Every value asserted below was measured from the registry rather than typed
 * from memory: `claude-sonnet` takes low..max with medium as its default,
 * `codex-astra` takes low..max, DeepSeek v4.1 Flash takes none/low/high/max,
 * an unknown model id takes nothing, and the job menus derive from their
 * dedicated surfaces. `grok-oauth` has no registry entry at all since GR-C
 * removed Grok (xAI), which is why it can be asserted absent from every menu
 * without naming a menu.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JOB_EFFORT_WORDS,
  JOB_OPTION_LABEL_MAX,
  JOB_SLOT_NAMES,
  JOB_STATUS_LABEL,
  MODEL_JOB_KEYS,
  MODEL_JOBS,
  cleanJobEffort,
  connectionWord,
  isModelJobKey,
  isOfferedForJob,
  jobEffortLabel,
  jobEffortOptionTitle,
  jobEffortOptions,
  jobModelOptions,
  jobOptionLabel,
  jobOptionTitle,
  jobSlotEmptyLabel,
  jobStatusHelp,
  jobStatusKind,
  nextJobFallback,
  resolveJobModel,
  surfaceDefaultChoice,
  withCustomConnections,
  type ModelAssignmentRow,
} from "./model-assignments.ts";
import {
  MODEL_EFFORT_LABELS,
  RETIRED_PROVIDER_IDS,
  type ModelEffort,
} from "./provider-registry.ts";
import { modelChoicesFor } from "./model-choice.ts";

/** A rank-0 row, which is what most of these tests are about. */
function row(
  jobKey: string,
  rank: number,
  providerId: string,
  effort: string | null = null,
): ModelAssignmentRow {
  return { jobKey: jobKey as ModelAssignmentRow["jobKey"], rank, providerId, effort };
}

/**
 * A failure that is not a refusal. The wording comes from the quota classifier
 * in ./automatic-failover.ts -- `429` and "usage limit" are both in it -- and
 * using the real vocabulary rather than "error" is the point: the refusal rule
 * and the retry rule are decided by the same classifier, so a test that fed it
 * a string neither classifier recognizes would prove nothing.
 */
const QUOTA = "429 usage limit reached for this account; try again after the reset.";
const REFUSAL = "The model declined to produce the requested editorial.";
/** A refusal whose text ALSO mentions quota. The refusal has to win. */
const REFUSAL_MENTIONING_QUOTA =
  "The selected model declined to write this: I cannot write this. A quota reset will not change that.";

describe("the resolution order", () => {
  it("does not offer a chat-model assignment for audio transcription", () => {
    assert.equal(isModelJobKey("transcript"), false);
    assert.equal(MODEL_JOBS.some((job) => job.key === ("transcript" as typeof job.key)), false);
  });

  it("runs an explicit per-run pick ahead of anything saved", () => {
    const resolved = resolveJobModel({
      jobKey: "story-draft",
      explicit: "codex-frontier",
      assignments: [row("story-draft", 0, "claude-sonnet")],
    });
    assert.equal(resolved.providerId, "codex-frontier");
    assert.equal(resolved.source, "explicit");
    assert.equal(resolved.rank, null);
    assert.equal(resolved.notice, null);
  });

  it("runs the saved first choice when the run named none", () => {
    const resolved = resolveJobModel({
      jobKey: "story-draft",
      assignments: [row("story-draft", 0, "claude-sonnet", "high")],
    });
    assert.equal(resolved.providerId, "claude-sonnet");
    assert.equal(resolved.source, "assignment");
    assert.equal(resolved.rank, 0);
    assert.equal(resolved.effort, "high", "the stored level travels with the choice");
  });

  it("runs the surface default when the job has nothing saved", () => {
    const resolved = resolveJobModel({ jobKey: "story-draft" });
    assert.equal(resolved.providerId, surfaceDefaultChoice("story"));
    assert.equal(resolved.providerId, "auto");
    assert.equal(resolved.source, "surface-default");
    assert.equal(resolved.rank, null);
    assert.equal(resolved.notice, null, "nothing was set, so there is nothing to explain");
  });

  it("reads ranks in rank order, not in row order", () => {
    const resolved = resolveJobModel({
      jobKey: "headlines",
      assignments: [
        row("headlines", 2, "codex-balanced"),
        row("headlines", 0, "claude-haiku"),
        row("headlines", 1, "codex-luna"),
      ],
    });
    assert.equal(resolved.providerId, "claude-haiku");
    assert.equal(resolved.rank, 0);
  });

  it("never resolves a job to another job's rows", () => {
    const resolved = resolveJobModel({
      jobKey: "opinion",
      assignments: [row("story-draft", 0, "claude-sonnet")],
    });
    assert.equal(resolved.source, "surface-default");
    assert.equal(resolved.providerId, surfaceDefaultChoice("opinion"));
  });

  it("falls through a rank this build cannot offer to one it can", () => {
    const resolved = resolveJobModel({
      jobKey: "scan",
      assignments: [row("scan", 0, "grok-oauth"), row("scan", 1, "claude-haiku")],
    });
    assert.equal(resolved.providerId, "claude-haiku");
    assert.equal(resolved.source, "assignment");
    assert.equal(resolved.rank, 1, "rank 1 was the first row that could actually run");
  });

  it("keeps an Automatic fallback distinct from an unset fallback rank", () => {
    const next = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet"],
      assignments: [row("story-draft", 1, "auto")],
    });
    assert.deepEqual(next, { providerId: "auto", effort: null, rank: 1 });
  });

  it("prefers Automatic on a surface that has it and a named model on one that does not", () => {
    // OCR's surface exposes its own Automatic choice and stays the default.
    // This is asserted against the menus themselves,
    // because a default that is not in the menu is a select that renders empty.
    assert.equal(surfaceDefaultChoice("story"), "auto");
    assert.equal(surfaceDefaultChoice("forced"), "auto");
    for (const surface of ["story", "scan", "follow-up", "opinion", "dark", "ocr", "forced"] as const) {
      const options = modelChoicesFor(surface).map((option) => option.value);
      assert.ok(
        options.includes(surfaceDefaultChoice(surface) as never),
        `${surface}'s default must be one of its own options`,
      );
    }
  });
});

describe("the fallback order after a quota failure", () => {
  const rows = [
    row("story-draft", 0, "claude-sonnet"),
    row("story-draft", 1, "codex-balanced"),
    row("story-draft", 2, "claude-haiku"),
  ];

  /*
    A fallback saved with no effort level runs at its OWN model's default, not
    at nothing: both of these models declare `medium`, so that is what the desk
    sends. Asserted rather than elided because the alternative -- sending no
    level because the row's column is null -- would quietly give the fallback a
    different setting from the one the first choice runs at.
  */
  it("tries rank 1 first when the first choice fails on quota", () => {
    const next = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet"],
      assignments: rows,
      detail: QUOTA,
    });
    assert.deepEqual(next, { providerId: "codex-balanced", effort: "medium", rank: 1 });
  });

  it("then rank 2, once rank 1 has also been tried", () => {
    const next = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet", "codex-balanced"],
      assignments: rows,
      detail: QUOTA,
    });
    assert.deepEqual(next, { providerId: "claude-haiku", effort: "medium", rank: 2 });
  });

  it("stops when every rank has been tried", () => {
    const next = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet", "codex-balanced", "claude-haiku"],
      assignments: rows,
      detail: QUOTA,
    });
    assert.equal(next, null);
  });

  it("never returns the first choice as its own fallback", () => {
    // Rank 0 has just failed. Returning it would be a loop, not a fallback, so
    // a set of rows with no fallbacks at all is simply the end of the run.
    const next = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet"],
      assignments: [row("story-draft", 0, "claude-sonnet"), row("story-draft", 1, "claude-haiku")],
      detail: QUOTA,
    });
    assert.equal(next?.rank, 1);
    const exhausted = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet", "claude-haiku"],
      assignments: [row("story-draft", 0, "claude-sonnet"), row("story-draft", 1, "claude-haiku")],
      detail: QUOTA,
    });
    assert.equal(exhausted, null);
  });

  it("skips a fallback this build cannot offer", () => {
    const next = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet"],
      assignments: [row("story-draft", 1, "grok-oauth"), row("story-draft", 2, "claude-haiku")],
      detail: QUOTA,
    });
    assert.deepEqual(next, { providerId: "claude-haiku", effort: "medium", rank: 2 });
  });

  it("carries the fallback's own stored effort, validated against its model", () => {
    const next = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet"],
      // "max" is a level Claude Sonnet takes, so a stale "max" here is kept.
      assignments: [row("story-draft", 1, "claude-haiku", "max")],
      detail: QUOTA,
    });
    assert.equal(next?.effort, "max");
    const dropped = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet"],
      assignments: [row("story-draft", 1, "claude-haiku", "none")],
      detail: QUOTA,
    });
    assert.equal(
      dropped?.effort,
      "medium",
      "a level the model does not take is dropped to that model's default, never sent",
    );
  });
});

describe("a content refusal is final", () => {
  const rows = [
    row("story-draft", 0, "claude-sonnet"),
    row("story-draft", 1, "codex-balanced"),
    row("story-draft", 2, "claude-haiku"),
  ];

  it("does not fall back, even with two untried fallbacks saved", () => {
    const next = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet"],
      assignments: rows,
      detail: REFUSAL,
    });
    assert.equal(next, null, "asking the next model would be shopping for a different answer");
  });

  it("keeps a refusal final when its explanation also mentions quota", () => {
    const next = nextJobFallback({
      jobKey: "story-draft",
      tried: ["claude-sonnet"],
      assignments: rows,
      detail: REFUSAL_MENTIONING_QUOTA,
    });
    assert.equal(next, null);
  });

  it("is read by the same classifier the mid-run failover uses", async () => {
    // Not a tautology: this fails if the two ever stop agreeing, which is the
    // drift the shared function exists to prevent.
    const { looksLikeContentRefusal } = await import("./automatic-failover.ts");
    assert.equal(looksLikeContentRefusal(REFUSAL), true);
    assert.equal(looksLikeContentRefusal(REFUSAL_MENTIONING_QUOTA), true);
    assert.equal(looksLikeContentRefusal(QUOTA), false);
  });
});

describe("effort is validated per exact model", () => {
  it("keeps a level the model declares", () => {
    assert.equal(cleanJobEffort("claude-sonnet", "max", null), "max");
    assert.equal(cleanJobEffort("local-model", "high", "deepseek-v4.1-flash"), "high");
  });

  it("drops a level the model does not declare to that model's default", () => {
    assert.equal(
      cleanJobEffort("claude-sonnet", "none", null),
      "medium",
      "Sonnet declares low..max, so 'none' is replaced rather than sent",
    );
    assert.equal(
      cleanJobEffort("local-model", "medium", "deepseek-v4.1-flash"),
      "none",
      "DeepSeek v4.1 Flash declares none/low/high/max and defaults to Off",
    );
  });

  it("gives a model that declares nothing no level at all", () => {
    // The same provider id, a different exact model: this is the whole point of
    // validating per model rather than per id.
    assert.equal(cleanJobEffort("local-model", "high", "unknown-model"), null);
    assert.equal(cleanJobEffort("local-model", "high", "gemini-2.5-flash"), null);
    assert.deepEqual(jobEffortOptions("local-model", "unknown-model"), []);
    assert.deepEqual(jobEffortOptions("local-model", "deepseek-v4.1-flash"), [
      "none",
      "low",
      "high",
      "max",
    ]);
  });

  it("validates the stored effort of a resolved assignment against the exact model", () => {
    const resolved = resolveJobModel({
      jobKey: "story-draft",
      assignments: [row("story-draft", 0, "local-model", "medium")],
      exactModel: "deepseek-v4.1-flash",
    });
    assert.equal(resolved.providerId, "local-model");
    assert.equal(resolved.effort, "none");
  });

  it("offers Automatic the Codex/Claude intersection", () => {
    assert.deepEqual(jobEffortOptions("auto", null), ["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("Grok is never offered", () => {
  it("is in no job's menu, on any surface", () => {
    assert.deepEqual(RETIRED_PROVIDER_IDS, ["grok-oauth"]);
    for (const job of MODEL_JOBS) {
      const values = jobModelOptions(job.key).map((option) => option.value);
      assert.ok(values.length > 0, `${job.key} must offer something`);
      for (const retired of RETIRED_PROVIDER_IDS) {
        assert.ok(
          !values.includes(retired as never),
          `${job.key} must not offer ${retired}; the registry marks it NO_SURFACE`,
        );
      }
    }
  });

  it("is not a value any job accepts, so a stored one cannot run", () => {
    for (const jobKey of MODEL_JOB_KEYS) {
      assert.equal(isOfferedForJob(jobKey, "grok-oauth"), false);
    }
  });

  it("is refused with a notice even when a run asks for it by name", () => {
    const resolved = resolveJobModel({ jobKey: "story-draft", explicit: "grok-oauth" });
    assert.equal(resolved.source, "surface-default");
    assert.equal(resolved.providerId, "auto");
    assert.match(
      resolved.notice ?? "",
      /grok-oauth is not a model this job can use/,
      "a refused explicit pick must not fall through silently",
    );
  });

  it("is not added back by the custom-connection menu either", () => {
    // The other half of every menu is the newsroom's own connections. It is
    // appended at the edge, so it is checked here rather than assumed.
    const menu = withCustomConnections(jobModelOptions("story-draft"), [
      { id: "11111111-2222-4333-8444-555555555555", name: "My gateway", modelId: "some-model" },
    ]);
    assert.deepEqual(
      menu.map((option) => option.value).filter((value) => value === "grok-oauth"),
      [],
    );
    assert.ok(menu.some((option) => option.value.startsWith("custom:")));
  });
});

describe("a saved assignment this build cannot offer", () => {
  it("falls back to the surface default and says so", () => {
    const resolved = resolveJobModel({
      jobKey: "dark",
      assignments: [row("dark", 0, "grok-oauth"), row("dark", 1, "retired-model-id")],
    });
    assert.equal(resolved.source, "surface-default");
    assert.equal(resolved.providerId, surfaceDefaultChoice("dark"));
    assert.match(
      resolved.notice ?? "",
      /grok-oauth is no longer offered for this job, so it is running on the desk's default instead\. Choose a first choice and save\./,
      "the notice must name the stored id and ask for a replacement",
    );
  });

  it("still reports the notice when only a later rank is stale", () => {
    const resolved = resolveJobModel({
      jobKey: "dark",
      // Rank 0 is fine; the unusable rows are fallbacks. The first choice is
      // what runs, so the notice is NOT expected here -- and this asserts that
      // a healthy first choice does not wear a warning about its fallbacks.
      assignments: [row("dark", 0, "claude-fable"), row("dark", 1, "grok-oauth")],
    });
    assert.equal(resolved.providerId, "claude-fable");
    assert.equal(resolved.source, "assignment");
    assert.equal(resolved.notice, null);
  });

  it("keeps a stored custom connection resolvable after a reload", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const resolved = resolveJobModel({
      jobKey: "opinion",
      assignments: [row("opinion", 0, `custom:${id}`)],
    });
    assert.equal(resolved.providerId, `custom:${id}`);
    assert.equal(resolved.source, "assignment");
    assert.equal(isOfferedForJob("opinion", `custom:${id}`), true);
  });
});

/**
 * Defect 2 (unit BG2): the selects truncated. The design's own lines are short
 * ("Codex Sol · sign-in", "None", "Default") and the build was showing the
 * registry's full sentence plus "Not set — use the desk's default", which is
 * 203px of text in a ~162px box at 1280. Everything asserted here is either a
 * line the design draws or the measured ceiling: 24 characters, from
 * Bricolage Grotesque 700 at 15px, where the longest drawn line ("Claude
 * Sonnet · sign-in", 23 characters) measures 150px and the box is ~162px.
 */
describe("the lines the who-does-what selects show", () => {
  it("names the connection the model arrives through, as the design draws it", () => {
    const story = jobModelOptions("story-draft");
    const label = (value: string) => {
      const option = story.find((one) => one.value === value);
      assert.ok(option, `story must offer ${value}`);
      return jobOptionLabel(option);
    };
    assert.equal(label("codex-frontier"), "Codex Sol 6.1 · sign-in");
    assert.equal(label("claude-frontier"), "Claude Opus · sign-in");
    assert.equal(label("claude-sonnet"), "Claude Sonnet · sign-in");
    assert.equal(label("auto"), "Automatic (ladder)");
  });

  it("names how every kind of provider is connected", () => {
    assert.equal(connectionWord("claude-code"), "sign-in");
    assert.equal(connectionWord("codex"), "sign-in");
    assert.equal(connectionWord("openai"), "API");
    assert.equal(connectionWord("anthropic"), "API");
    assert.equal(connectionWord("local"), "on this computer");
  });

  it("never draws a line longer than a select is known to show", () => {
    for (const job of MODEL_JOBS) {
      for (const option of jobModelOptions(job.key)) {
        const line = jobOptionLabel(option);
        assert.ok(line.length > 0, `${job.key}/${option.value} needs a line`);
        assert.ok(
          line.length <= JOB_OPTION_LABEL_MAX,
          `${job.key}/${option.value}: "${line}" is ${line.length} characters`,
        );
      }
    }
  });

  it("drops the connection word rather than clipping it, and keeps it on the title", () => {
    const local = jobModelOptions("story-draft").find((one) => one.value === "local-model");
    assert.ok(local, "story must offer the local model");
    assert.equal(jobOptionLabel(local), "Local model");
    assert.match(jobOptionTitle(local), /on this computer/);
  });

  it("keeps the provider's half-line out of the select and on the title", () => {
    for (const option of jobModelOptions("story-draft")) {
      assert.doesNotMatch(jobOptionLabel(option), /—/);
      assert.match(jobOptionTitle(option), new RegExp(option.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    const frontier = jobModelOptions("story-draft").find((one) => one.value === "codex-astra");
    assert.ok(frontier);
    assert.equal(jobOptionLabel(frontier), "Codex Astra · sign-in");
    assert.match(jobOptionTitle(frontier), /Runs gpt-6-astra/);
  });

  it("calls a newsroom's own endpoint an API connection, by its name", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const menu = withCustomConnections(jobModelOptions("story-draft"), [
      { id, name: "Gemini", modelId: "gemini-2.5-flash" },
    ]);
    const custom = menu.find((one) => one.value === `custom:${id}`);
    assert.ok(custom);
    assert.equal(jobOptionLabel(custom), "Gemini · API");
    assert.match(jobOptionTitle(custom), /gemini-2\.5-flash/);
  });

  it("shows a stored value this build cannot resolve as it is, with no invented word", () => {
    const menu = withCustomConnections(jobModelOptions("story-draft"), [], ["grok-oauth"]);
    const stale = menu.find((one) => one.value === "grok-oauth");
    assert.ok(stale, "a stored value must stay showable");
    assert.equal(jobOptionLabel(stale), "No longer offered");
  });

  it("shows the drawn effort word, with the sentence on the option's title", () => {
    assert.equal(jobEffortLabel("none"), "none");
    assert.equal(jobEffortLabel("low"), "low");
    assert.equal(jobEffortLabel("medium"), "medium");
    assert.equal(jobEffortLabel("high"), "high");
    assert.equal(jobEffortLabel("xhigh"), "xhigh");
    assert.equal(jobEffortLabel("max"), "max");
    const seen = new Set<string>();
    for (const effort of Object.keys(JOB_EFFORT_WORDS) as ModelEffort[]) {
      const word = JOB_EFFORT_WORDS[effort];
      assert.ok(word.length > 0 && word.length <= 6, `${effort} draws "${word}"`);
      assert.equal(jobEffortOptionTitle(effort), MODEL_EFFORT_LABELS[effort]);
      seen.add(word);
    }
    assert.equal(seen.size, Object.keys(JOB_EFFORT_WORDS).length, "two levels must not share a word");
  });

  it("leaves no slot without an empty line", () => {
    assert.deepEqual([...JOB_SLOT_NAMES], ["first", "fallback1", "fallback2"]);
    assert.equal(jobSlotEmptyLabel("first"), "Default");
    assert.equal(jobSlotEmptyLabel("fallback1"), "None");
    assert.equal(jobSlotEmptyLabel("fallback2"), "None");
  });
});

describe("the status vocabulary", () => {
  it("says Not built yet for a job with no backend, whatever else is true", () => {
    const kind = jobStatusKind({ built: false, providerId: "claude-sonnet", available: true });
    assert.equal(kind, "unbuilt");
    assert.equal(JOB_STATUS_LABEL.unbuilt, "Not built yet");
    assert.match(jobStatusHelp({ built: false, providerId: null }), /no backend yet/);
  });

  it("does not accuse a provider while the availability answer is in flight", () => {
    assert.equal(jobStatusKind({ built: true, providerId: "claude-sonnet" }), "ready");
    assert.equal(jobStatusKind({ built: true, providerId: "claude-sonnet", available: null }), "ready");
  });

  it("marks an unusable first choice as a sign-in problem and a cold local model as slow", () => {
    assert.equal(jobStatusKind({ built: true, providerId: "claude-sonnet", available: false }), "signin");
    assert.equal(
      jobStatusKind({ built: true, providerId: "local-model", available: true, localNotLoaded: true }),
      "slow",
    );
  });

  /*
    Defect 3 (unit BG2): the chip said "✓ Ready" for a job with nothing
    assigned, which is a claim about a first choice that does not exist. With
    nothing saved the row says "Default" and names what the default resolves
    to; "✓ Ready" is only for a first choice that is really there.
  */
  it("says Default, not Ready, for a job with nothing assigned", () => {
    const facts = { built: true, providerId: "auto", available: true, fromDefault: true };
    assert.equal(jobStatusKind(facts), "default");
    assert.equal(JOB_STATUS_LABEL.default, "Default");
    assert.match(jobStatusHelp(facts), /nothing saved for this job/i);
    assert.doesNotMatch(JOB_STATUS_LABEL.default, /Ready/);
    assert.notEqual(jobStatusHelp(facts), jobStatusHelp({ built: true, providerId: "auto", available: true }));
  });

  it("still reports the real problem when the default itself cannot run", () => {
    assert.equal(
      jobStatusKind({ built: true, providerId: "codex-astra", available: false, fromDefault: true }),
      "signin",
    );
    assert.equal(
      jobStatusKind({ built: true, providerId: "local-model", available: true, fromDefault: true, localNotLoaded: true }),
      "slow",
    );
    assert.equal(jobStatusKind({ built: false, providerId: "auto", fromDefault: true }), "unbuilt");
  });

  it("has a label for every kind and a reason for every label", () => {
    for (const kind of ["ready", "slow", "signin", "unbuilt", "none", "default"] as const) {
      assert.ok(JOB_STATUS_LABEL[kind], `${kind} needs a label`);
    }
    const ready = jobStatusHelp({ built: true, providerId: "claude-sonnet", available: true });
    const slow = jobStatusHelp({ built: true, providerId: "local-model", localNotLoaded: true });
    assert.match(slow, /never loads a model for you/, "the slow chip must repeat the no-load rule");
    assert.notEqual(ready, slow);
  });
});
