-- Who does what: which writing model runs which job, and what it falls back to (redesign phase 5).
--
-- Until now the desk chose a model per SURFACE. `provider-registry.ts` knows
-- five of them -- story, scan, opinion, dark, forced -- and every picker in
-- the app offers one surface's list. That is the right shape for a control an
-- editor meets at the moment of a run ("draft this lead with..."), and the
-- wrong shape for the question the owner actually asks about a paper: which
-- model does the daily scan, which one scores leads, which one writes the
-- opinion, and what happens when the first one is down. Those answers are
-- properties of the JOB, not of the screen the job happens to be started
-- from, and today they exist nowhere except in code and in an editor's head.
--
-- This table is that answer, one row per (job, rank). Rank 0 is the first
-- choice; ranks 1 and 2 are the fallbacks, in the order the desk tries them.
-- A job with no rows at all is unassigned on purpose: the desk falls through
-- to the surface default and Automatic exactly as it does today, so a paper
-- that never opens this screen keeps the behavior it already has.
--
-- WHY A TABLE AND NOT COLUMNS ON AN EXISTING ROW. There is no per-job row to
-- hang them on -- the jobs are a fixed vocabulary in code (`job_key` in
-- src/lib/news/model-assignments.ts), not rows in a table -- and the two
-- fallbacks would have to be three sets of columns with three nullable
-- provider ids, three nullable efforts and a rank ordering implied by name.
-- A keyed row says the ordering once, lets a job have one choice or three,
-- and makes "the first choice and both fallbacks" a single read.
--
-- `job_key` is text, not a Postgres enum, for the same reason 0097 chose text
-- for `proposed_by`: the vocabulary grows as the desk grows a job, and every
-- addition would otherwise be a migration that drops nothing and rewrites a
-- type. An unknown job_key is ignored by the reader, not an error, so a row
-- written by a newer build cannot break an older one's page.
--
-- `provider_id` holds exactly what `desk_jobs.model_choice` holds: a
-- `PICKER_PROVIDER_IDS` id, `auto`, or a `custom:<uuid>` connection. A
-- retired id is read, not offered (the desk says why and falls through) --
-- storing it never becomes permission to run it. `grok-oauth` is registered
-- with `offeredFor: NO_SURFACE` and is in no option list anywhere, including
-- this table's UI, which builds its menus from `providersFor(surface)`.
--
-- `effort` is one of none|low|medium|high|xhigh|max, or null for "whatever
-- the provider defaults to". It is validated per exact model at read time
-- with `modelEffortsFor(id, exactModel)` rather than by a check constraint,
-- because the valid levels depend on the model behind the id (a local model
-- declares its own, a custom connection's are read from the transport) and a
-- constraint could not see that. A stored level the current model does not
-- take is dropped to the provider default with the model, never sent.
--
-- Additive and optional: nothing existing is read differently, no run path is
-- required to consult this table, and an empty table means today's behavior.
-- Mirrored by `ensureModelAssignmentsSchema()` in
-- src/lib/news/model-assignments-store.ts for the PGLite preview and
-- unit-test paths, exactly as provider_settings is by
-- ensureProviderSettingsSchema().
create table if not exists model_assignments (
  newsroom_id integer not null default 1 references newsrooms(id) on delete cascade,
  job_key text not null,
  rank smallint not null check (rank between 0 and 2),
  provider_id text not null,
  effort text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (newsroom_id, job_key, rank)
);

comment on table model_assignments is
  'Which model does which desk job, per newsroom, rank 0 = first choice and 1-2 = fallbacks in the order they are tried. No rows for a job means the surface default and Automatic, which is the behavior before this table existed.';
comment on column model_assignments.job_key is
  'The job this choice is for: scan | lead-score | story-draft | opinion | evidence-check | headlines | dark | follow-up | ocr | transcript (src/lib/news/model-assignments.ts). Text, not an enum, so a new job is not a migration. An unknown key is ignored by the reader.';
comment on column model_assignments.rank is
  '0 = first choice, 1 = Fallback 1, 2 = Fallback 2. The desk tries them in this order.';
comment on column model_assignments.provider_id is
  'A registry provider id, "auto", or a custom:<uuid> connection -- the same values desk_jobs.model_choice holds. A retired id is read but never offered or run.';
comment on column model_assignments.effort is
  'Thinking effort: none | low | medium | high | xhigh | max. Null means the provider default. Revalidated against the exact model with modelEffortsFor() before a run uses it.';
comment on column model_assignments.updated_at is
  'When this row last changed. Save assignments rewrites the whole set for a job, so this moves whenever the editor saves.';
