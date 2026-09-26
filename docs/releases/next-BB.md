# Next TownReporter patch — local model picker (unit BB)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or any live-model result. **No model was loaded, unloaded or called to write it**, in code or in a test; every check in it ran against fake catalogs and fake servers.

## What the picker shows, and what it now does not do

Choosing **Local model** used to list every model on disk with no indication of
which were in memory, and the word "loaded" appeared only in the option's hover
title. The load state was known — discovery has always read LM Studio's
`/api/v0/models` and Ollama's `/api/ps` — it just never reached the list.

Four changes, all in that picker:

1. **The list says what is loaded.** A model in memory reads
   `<id> · loaded`; its id still comes first, because that is the part an editor
   is choosing between. Inside each server group, loaded models sort first, then
   the rest, by id within each group.
2. **"Use whatever is loaded" is the first choice.** It is stored as an
   ordinary pick with a sentinel (`*` in both halves) rather than a new column:
   `base_url` and `model_id` are plain `text not null` with no value
   constraint, the save validator accepts any two non-empty strings, and the
   sentinel cannot collide with a real pick (a real one always carries a server
   address). **No migration.** At call time it resolves through the same
   function the Automatic rung already used — LM Studio before Ollama, same
   order — and the receipt names the model that actually ran
   (`Local model (halo-brain-35b)`), as the rung does.
3. **That choice is also the new default** when nothing has been stored and a
   local server reports a loaded non-embedding model. When nothing is loaded,
   the default is unchanged (the preferred cloud model, else the catalog's own)
   and the help line says which model it is using and why.
4. **The desk never loads a model.** A hand-picked, non-cloud model on a server
   that reports load state, when that report says not loaded, now stops before
   the call: *"`<id>` is not loaded in LM Studio. Load it there, or pick Use
   whatever is loaded."* Nothing loaded behind "Use whatever is loaded" stops
   with *"Local model: nothing is loaded in LM Studio or Ollama. Load a model
   there, or pick a model."* Either sentence is the desk's own, complete, and
   reaches the operator as the guidance line. A server that reports **no** load
   state (llama.cpp) behaves exactly as before, and an Ollama Cloud pick is
   never blocked.

The help line under the select now answers the question in words: loaded now,
not loaded, no load state reported, a cloud model, which model "use whatever is
loaded" is currently pointing at, or which model a run would fall back to.

## Targeted evidence

Red first: both new files were run against the code before it existed and failed
with `SyntaxError: The requested module './preflight.ts' does not provide an
export named 'LOCAL_MODEL_NOTHING_LOADED'`, exit 1 each.

- `src/lib/news/local-loaded-picker.test.ts` — **19/19, exit 0.** Option text
  (id first; bare id when not loaded or no load state), ordering, the sentinel
  predicate, the help line in each of its seven states, and the exact refusal
  sentences.
- `src/lib/news/local-loaded-choice.test.ts` — **9/9, exit 0.** Against a real
  PGlite choice row and fake LM Studio/Ollama stubs: the sentinel resolves to
  the loaded model and labels the receipt; nothing loaded and not-loaded hand
  picks each fail with the exact sentence; `loaded: null` and a cloud pick are
  allowed; the default follows the load state; and nothing that reaches a call
  ever carries `*`.
- **"No fetch to the model endpoint" is asserted with a fetch spy**, as the unit
  requires: the stub records every URL it is asked for, and the refusal tests
  assert that no `/chat/completions` URL appears in that log — never that a
  message says so.
- Regressions, all exit 0: `preflight` + `model-choice` + `local-models` +
  `provider-settings.local-model` 69/69; `ai.test.ts` 71/71;
  `scripts/model-picker-render.test.mjs` 15/15.

## Limits

- The fake servers reproduce the discovery HTTP shapes, not LM Studio's or
  Ollama's real behaviour. **A live LM Studio or Ollama was not exercised**, by
  design: this unit is forbidden from loading or unloading a model, so a live
  check would have had to move someone's loaded model.
- The default in item 3 is only as good as the load-state report at the moment
  the run resolves it. A model loaded after the picker renders but before the run
  starts is picked up (the choice resolves at call time); one unloaded in that
  window produces the item-4 refusal rather than a silent substitution.
- Only the local picker path is covered. The Automatic ladder's own use of
  `pickLoadedLocalModel` is unchanged, and no cloud provider was re-tested.
- No end-to-end run in a browser was performed; the picker's render behaviour is
  pinned through pure helpers, this repo having no component-rendering harness
  that parses JSX.
