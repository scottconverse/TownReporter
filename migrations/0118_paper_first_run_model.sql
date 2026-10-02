-- Unit F3 / Option A: which installs were OFFERED a first-run writing model.
--
-- The owner's requirement (2026-10-02): a fresh install defaults to whatever
-- local model is loaded, and when nothing is loaded it offers a choice from
-- the models LM Studio and Ollama report. That offer is a card on the owner's
-- first desk page -- and a card that draws from a stored fact, not from a
-- guess about the paper's state, because the LIVE paper is `onboarded = true`
-- with empty name/city/state (the F4/SG1 shape) and must never see it.
--
-- One nullable text column, and NULL is the answer for every paper that
-- already exists:
--
--   NULL       never offered. The live release, every install set up before
--              this build, and any newsroom whose setup ran with no local
--              server answering. The card does not draw.
--   'stored'   setup finished with a model IN MEMORY, so the writing choice
--              was stored for this paper. No card: it already has a model.
--   'offered'  setup finished with a server answering but nothing in memory.
--              The card draws until the owner answers it.
--   'answered' the owner chose a model from the card, or pressed "Keep the
--              Automatic ladder". Either way the card stays gone.
--
-- The value is written ONLY by the first-run hook, at the false-to-true
-- `onboarded` flip (src/lib/news/first-run-model-settings.ts, called from
-- `completeFirstRunSetup`). Nothing on a page load writes it, and a paper that
-- re-runs setup from the Server page keeps whatever it already holds.
--
-- Additive and nullable, so the previous build -- which never reads this
-- column -- keeps writing and reading `paper_settings` exactly as it does
-- today. No default, no constraint, nothing dropped or retyped.
alter table paper_settings
  add column if not exists model_prompt_state text;

comment on column paper_settings.model_prompt_state is
  'Unit F3 / Option A: NULL = the first-run writing-model offer never ran for this paper (the live paper and every pre-existing install). stored = setup stored a loaded local model. offered = the Choose your writing model card is waiting on the owner. answered = the owner chose a model from the card or kept Automatic. Written only by the first-run hook at the onboarded flip.';
