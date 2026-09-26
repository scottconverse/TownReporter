/*
  Unit BB item 1 and item 2's words: what the local-model list SHOWS and what
  the desk SAYS when a hand-picked model is not loaded.

  Pure functions only, for the reason `localModelOptionLabel`'s own comment
  gives: this repo has no component-rendering harness that can parse JSX, so
  the picker's render behavior is pinned through these helpers instead.
*/

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  USE_LOADED_LOCAL_MODEL,
  USE_LOADED_LOCAL_MODEL_LABEL,
  isUseLoadedLocalModelPick,
  localModelOptionText,
  localModelSelectionHelp,
  sortLocalModelsForPicker,
} from "./model-choice.ts";
import {
  LOCAL_MODEL_NOTHING_LOADED,
  isLocalModelNotReady,
  localModelNotLoadedMessage,
  localServerName,
  scanPreflight,
} from "./preflight.ts";

function model(over: Partial<{
  id: string;
  loaded: boolean | null;
  cloud: boolean;
  vision: boolean;
  contextLength: number | null;
}> = {}) {
  return {
    id: "gemma4:12b",
    loaded: true as boolean | null,
    cloud: false,
    vision: false,
    contextLength: null,
    ...over,
  };
}

describe("the local-model option text says which models are loaded", () => {
  it("appends ' · loaded' to a loaded model and keeps the id first", () => {
    assert.equal(localModelOptionText(model({ id: "halo-brain-35b" })), "halo-brain-35b · loaded");
    assert.ok(
      localModelOptionText(model({ id: "halo-brain-35b" })).startsWith("halo-brain-35b"),
      "the id must come first -- it is the part an editor is choosing between",
    );
  });

  it("leaves an unloaded model, and a server that reports no load state, as the bare id", () => {
    assert.equal(localModelOptionText(model({ loaded: false })), "gemma4:12b");
    assert.equal(localModelOptionText(model({ loaded: null })), "gemma4:12b");
  });
});

describe("the local-model list puts loaded models first", () => {
  it("orders loaded first then the rest, by id inside each group, without mutating the input", () => {
    const input = [
      model({ id: "qwen3.6-35b", loaded: false }),
      model({ id: "gemma4:12b", loaded: true }),
      model({ id: "llama-4", loaded: null }),
      model({ id: "halo-brain-35b", loaded: true }),
    ];
    const before = input.map((m) => m.id);
    assert.deepEqual(sortLocalModelsForPicker(input).map((m) => m.id), [
      "gemma4:12b",
      "halo-brain-35b",
      "llama-4",
      "qwen3.6-35b",
    ]);
    assert.deepEqual(input.map((m) => m.id), before, "the catalog's own array must not be reordered");
  });

  it("treats a server that reports no load state as 'the rest', keeping its id order", () => {
    assert.deepEqual(
      sortLocalModelsForPicker([
        model({ id: "b", loaded: null }),
        model({ id: "a", loaded: null }),
      ]).map((m) => m.id),
      ["a", "b"],
    );
  });
});

describe("the 'Use whatever is loaded' sentinel", () => {
  it("is recognizable in the columns the database already has, and nothing else is", () => {
    assert.equal(isUseLoadedLocalModelPick({ baseUrl: USE_LOADED_LOCAL_MODEL, id: USE_LOADED_LOCAL_MODEL }), true);
    assert.equal(isUseLoadedLocalModelPick({ baseUrl: "http://127.0.0.1:1234/v1", id: "*" }), false);
    assert.equal(isUseLoadedLocalModelPick({ baseUrl: "*", id: "gemma4:12b" }), false);
    assert.equal(isUseLoadedLocalModelPick(null), false);
    assert.equal(isUseLoadedLocalModelPick(undefined), false);
  });

  it("is a non-empty pair, so the stored columns and their validator both accept it", () => {
    // `cleanLocalModelInput` (request-input.ts) stores a pick only when both
    // halves are non-empty strings, and both columns are `text not null`.
    assert.equal(USE_LOADED_LOCAL_MODEL.length > 0, true);
    assert.equal(USE_LOADED_LOCAL_MODEL_LABEL, "Use whatever is loaded");
  });
});

describe("the help line under the local-model select", () => {
  it("says a loaded on-device model will answer right away", () => {
    assert.equal(
      localModelSelectionHelp({ model: model({ id: "halo-brain-35b" }), serverKind: "lmstudio", source: "stored" }),
      "This model is loaded in LM Studio now, so it answers right away.",
    );
  });

  it("says a model that is not loaded stops the run before the call", () => {
    const help = localModelSelectionHelp({
      model: model({ id: "gemma4:12b", loaded: false }),
      serverKind: "ollama",
      source: "stored",
    });
    assert.match(help, /not loaded in Ollama now/);
    assert.match(help, /stops before the call/);
    assert.match(help, /Load it there, or pick Use whatever is loaded/);
  });

  it("says plainly when the server cannot report load state at all", () => {
    const help = localModelSelectionHelp({
      model: model({ id: "local-test-model", loaded: null }),
      serverKind: "llamacpp",
      source: "stored",
    });
    assert.match(help, /does not report which models are loaded/);
    assert.match(help, /first call can take a minute or more/);
  });

  it("keeps the Ollama Cloud sentence for a hosted model", () => {
    const help = localModelSelectionHelp({
      model: model({ id: "deepseek-v4.1-flash:cloud", loaded: null, cloud: true }),
      serverKind: "ollama",
      source: "stored",
    });
    assert.match(help, /runs on Ollama's hosted service, not on this computer/);
  });

  it("names the model 'Use whatever is loaded' is running now", () => {
    const help = localModelSelectionHelp({
      model: model({ id: "halo-brain-35b" }),
      serverKind: "lmstudio",
      source: "loaded",
    });
    assert.match(help, /whichever model is loaded when the run starts/);
    assert.match(help, /currently halo-brain-35b/);
    assert.match(help, /never loads a model for you/);
  });

  it("says nothing is loaded yet rather than naming a model it does not have", () => {
    const help = localModelSelectionHelp({ model: null, serverKind: null, source: "loaded" });
    assert.match(help, /Nothing is loaded in LM Studio or Ollama right now/);
    assert.match(help, /never loads a model for you/);
  });

  it("says which model it is using and why when nothing is loaded and nothing was stored", () => {
    const help = localModelSelectionHelp({
      model: model({ id: "deepseek-v4.1-flash:cloud", loaded: null, cloud: true }),
      serverKind: "ollama",
      source: "default",
    });
    assert.match(help, /Nothing is loaded in LM Studio or Ollama right now/);
    assert.match(help, /so this run will use deepseek-v4\.1-flash:cloud/);
  });
});

describe("the refusal the desk gives before any model call", () => {
  it("is the exact sentence the unit asks for when nothing is loaded", () => {
    assert.equal(
      LOCAL_MODEL_NOTHING_LOADED,
      "Local model: nothing is loaded in LM Studio or Ollama. Load a model there, or pick a model.",
    );
  });

  it("names the model and the server it is not loaded in", () => {
    assert.equal(
      localModelNotLoadedMessage("gemma4:12b", "ollama"),
      "gemma4:12b is not loaded in Ollama. Load it there, or pick Use whatever is loaded.",
    );
    assert.equal(
      localModelNotLoadedMessage("halo-brain-35b", "lmstudio"),
      "halo-brain-35b is not loaded in LM Studio. Load it there, or pick Use whatever is loaded.",
    );
  });

  it("calls each server what the operator calls it", () => {
    assert.equal(localServerName("lmstudio"), "LM Studio");
    assert.equal(localServerName("ollama"), "Ollama");
    assert.equal(localServerName("llamacpp"), "llama.cpp");
    assert.equal(localServerName("openai-compatible"), "the local server");
  });

  it("recognizes both refusals, and not an unrelated provider message", () => {
    assert.equal(isLocalModelNotReady(LOCAL_MODEL_NOTHING_LOADED), true);
    assert.equal(isLocalModelNotReady(localModelNotLoadedMessage("gemma4:12b", "ollama")), true);
    assert.equal(isLocalModelNotReady("Codex is not installed on this machine."), false);
    assert.equal(isLocalModelNotReady(""), false);
  });

  it("passes the desk's own sentence through the preflight as the guidance", () => {
    const nothing = scanPreflight({ ok: false, error: LOCAL_MODEL_NOTHING_LOADED }, "local-model");
    assert.equal(nothing.ok, false);
    if (!nothing.ok) {
      assert.equal(nothing.guidance, LOCAL_MODEL_NOTHING_LOADED);
      assert.equal(nothing.detail, "", "the sentence is complete; the raw text must not be doubled up");
      assert.equal(nothing.retryable, false);
    }
    const notLoaded = scanPreflight(
      { ok: false, error: localModelNotLoadedMessage("gemma4:12b", "ollama") },
      "local-model",
    );
    assert.equal(notLoaded.ok, false);
    if (!notLoaded.ok) {
      assert.equal(notLoaded.guidance, localModelNotLoadedMessage("gemma4:12b", "ollama"));
      assert.equal(notLoaded.detail, "");
      assert.equal(notLoaded.retryable, false);
    }
  });

  it("keeps the unrelated generic guidance for a refusal it does not own", () => {
    const other = scanPreflight({ ok: false, error: "connection refused" }, "local-model");
    assert.equal(other.ok, false);
    if (!other.ok) {
      assert.notEqual(other.guidance, LOCAL_MODEL_NOTHING_LOADED);
      assert.equal(other.detail, "connection refused");
    }
  });
});
