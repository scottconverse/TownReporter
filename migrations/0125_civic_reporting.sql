-- Editor-first civic reporting: the assignment, its durable run workspace, and
-- the structured reporting package it produces.
--
-- WHY THIS EXISTS. The editor-facing action ("Report this meeting" / "Develop
-- this lead") must run the installed civic-scanner method behind the desk and
-- hand back a package an editor can read, check and follow up -- without the
-- editor operating command-line tools or moving files, and without the import
-- path's known 4000-character note truncation (report E02).
--
-- `reporting_requests` is the durable run workspace: the assignment, the
-- editorial direction, the seed sources, the model identity/runtime receipt,
-- the method/version, and a stage/progress receipt the job row points at. One
-- row is one run; a follow-up is a NEW row that carries `parent_request_id`, so
-- no run overwrites a newer one and cancellation/claim fencing stays a property
-- of the existing desk_jobs machinery.
--
-- `reporting_packages` is the structured result and is deliberately NOT a text
-- note. It is jsonb, one row per request, holding the coverage ledger, the
-- claim/source ledger with public URLs and page/item/time locators, the
-- four-component newsworthiness score and its separately-assigned readiness
-- tier, the explicit unknowns, and the run receipt (method version, model
-- identity). jsonb (not text) is the point: the package survives intact, is
-- reviewable claim-by-claim, and is never squeezed through a length-capped
-- notes column. It links to the lead it is attached to and, when one exists,
-- the draft it was written against, so the desk can show it beside the copy.
--
-- Both tables are additive and migration-only, like 0120-0123: no runtime
-- ensure writes them (see the migrations-only note in schema-parity.test.ts).

create table if not exists reporting_requests (
  id bigserial primary key,
  user_id text not null,
  newsroom_id integer not null default 1,
  -- "meeting" | "lead" | "assignment" -- what the editor asked to report on.
  request_kind text not null default 'lead',
  -- The lead this run reports on, when it reports on one. Null for an
  -- independent desk assignment with no lead row yet.
  lead_id integer,
  -- A follow-up run points at the run it continues; null for a first run.
  parent_request_id bigint,
  -- "Report this meeting" | "Develop this lead" | "Follow up".
  action text not null default 'Report this lead',
  -- The editor's own words: subject, direction, what to account for separately.
  assignment text not null default '',
  -- Seed sources the editor supplied (URLs), as a JSON array of strings.
  seed_urls jsonb not null default '[]'::jsonb,
  -- The effective model choice the run was pinned to at enqueue.
  model_choice text not null default 'auto',
  -- The civic-scanner method/version this run was told to use, e.g. "2.6.0".
  method_version text not null,
  -- The resolved method directory actually read at run time (may be the
  -- packaged asset or an operator-configured directory).
  method_source text not null default '',
  -- Full model runtime receipt (requested/actual runtime, effort, failover).
  model_receipt jsonb not null default '{}'::jsonb,
  -- Where the run's durable workspace lives on disk, when one was written.
  workspace_dir text not null default '',
  -- The run's terminal state: COMPLETE | PARTIAL | FAILED, per the method's gate.
  run_status text not null default 'PENDING',
  -- Human-readable reason for a PARTIAL/FAILED run, so a gap is visible.
  run_note text not null default '',
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists reporting_requests_lead_idx
  on reporting_requests (newsroom_id, lead_id, created_at desc);
comment on table reporting_requests is
  'One civic-reporting run requested from the desk: assignment, seed sources, pinned model/method, and run status. A follow-up is a new row pointing at its parent.';

create table if not exists reporting_packages (
  id bigserial primary key,
  request_id bigint not null,
  newsroom_id integer not null default 1,
  lead_id integer,
  draft_id integer,
  -- The full structured package: coverage ledger, claim/source ledger with
  -- locators, scoring, readiness, unknowns, run receipt. Never truncated.
  package jsonb not null default '{}'::jsonb,
  -- A short, editor-readable headline for the package (its lead story).
  headline text not null default '',
  -- Readiness tier 1/2/3, assigned separately from the newsworthiness score.
  readiness_tier integer not null default 0,
  -- The four-component score total (4..20), 0 when the run scored nothing.
  score_total integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists reporting_packages_request_uidx
  on reporting_packages (request_id);
create index if not exists reporting_packages_lead_idx
  on reporting_packages (newsroom_id, lead_id, created_at desc);
comment on table reporting_packages is
  'The structured result of one civic-reporting run, as jsonb: coverage ledger, claim/source ledger with locators, score+readiness, unknowns, run receipt. Read whole; never length-capped.';

-- Newly found sources are proposed through the existing suggestion machinery,
-- and scoped editor observations are saved for the next assignment. This table
-- is the dated, sourced observation record -- not a second source list and not
-- a model-training store. `source_id` points at the existing accepted source
-- when the observation corrects one; null when it is a general note.
create table if not exists reporting_observations (
  id bigserial primary key,
  newsroom_id integer not null default 1,
  user_id text not null,
  request_id bigint,
  lead_id integer,
  source_id integer,
  -- "source" | "correction" | "disposition" | "retrieval".
  kind text not null default 'source',
  -- The observation, in the editor's or reporter's words.
  text text not null default '',
  -- The dated, sourced justification (a URL or an honest offline reference).
  evidence text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists reporting_observations_scope_idx
  on reporting_observations (newsroom_id, created_at desc);
comment on table reporting_observations is
  'Dated, sourced reporting observations (new-source notes, editor corrections, dispositions) saved for retrieval into the next relevant assignment. Not a second source registry and not a training store.';
