-- AI follow-ups: a follow-up stops being a row the editor works and becomes an
-- agent that keeps working (redesign phase 6, lane 2).
--
-- 0042 made `follow_ups` a list of asks: who was asked, what they owe, when it
-- is due. The editor drove every one of them -- nudging, recording the reply,
-- dropping it. The redesign turns the same list into background agents: an
-- agent re-checks pages on a schedule, searches public records for an answer,
-- or watches a meeting body's portal for the next agenda, and reports what it
-- finds. That needs four things the 0042 table has no room for: WHAT the agent
-- does and WHERE, WHEN it next runs, WHICH model runs it, and WHAT it last
-- found.
--
-- WHY THE OLD COLUMNS STAY. `who` and `what` are still the human-readable ask,
-- and every row written before this migration has nothing but those two and a
-- due date. Those rows are not migrated into agents, because there is nothing
-- to infer an agent from -- a manual "ask the fire marshal for the incident
-- report" is not a page to re-check or a query to search. They keep rendering,
-- with `agent_kind` null, as Manual cards on the same screen. `status` grows a
-- second vocabulary beside theirs rather than replacing it: the old three
-- (open | answered | dropped) describe a manual ask, the new four (active |
-- paused | stopped | done) describe an agent, and an old row must not fail its
-- check constraint because a new build shipped. The constraint is therefore
-- widened to the union of the two sets, not rewritten.
--
-- `agent_kind` is text with a check, not an enum, for the same reason
-- model_assignments.job_key is text: a fourth agent would otherwise be a
-- migration that rewrites a type to add a label. Null means "manual row".
--
-- `schedule` is one of a small fixed vocabulary the app understands --
-- 2h | 6h | 12h | daily | weekly | posting-days -- because `next_run_at` is
-- computed from it by the in-app scheduler and an unrecognised value would
-- have to mean "never runs" (a silently dead agent) or "runs every tick".
-- Storing an interval in text rather than a `interval` column keeps the same
-- vocabulary in the database, in the dialog and in the scheduler's switch.
--
-- `model_choice` holds what `desk_jobs.model_choice` holds: a registry
-- provider id, `auto`, or a custom:<uuid> connection. `auto` is the default
-- and means the phase 5 resolution order -- the follow-up's own pick if an
-- editor set one, else the `follow-up` row in `model_assignments`, else the
-- surface default. This column is the per-follow-up pick, not the resolution.
--
-- `last_state` is the agent's last outcome, and it is deliberately five
-- values rather than a boolean "found something". An agent that ran and found
-- nothing (`no-change`) is healthy; an agent that could not reach the page
-- (`could-not-check`) is not, and the editor has to be able to tell those
-- apart on the screen -- a follow-up that has been quietly failing for a week
-- must not look like a follow-up that has been quietly working. `running` and
-- `waiting` are the two live states the card renders differently. The reason
-- behind a `could-not-check` lives in `finding_json.reason`, so the screen can
-- say what actually went wrong instead of only that it did.
--
-- `finding_json` holds what the last run found: { title, summary, url, reason,
-- checked_at, changed }. It is the card's "latest result" line and the thing
-- that is written to the story's reporting notes. It is NOT a publish queue
-- and nothing in this feature reads it to write an article -- a follow-up
-- never publishes.
--
-- `targets_json` holds the URLs the agent watches or starts from: a JSON array
-- of strings. For `recheck` these become the manual page-watch rows; for
-- `agenda` they are the portal URLs of the bodies being watched; for `search`
-- they are optional seed links, and an empty array is normal (the agent
-- searches).
--
-- Additive and optional: a row with `agent_kind` null behaves exactly as it
-- did before this migration. Mirrored by `ensureFollowUpsSchema()` in
-- src/lib/news/follow-ups.ts for the PGLite preview and unit-test paths,
-- exactly as 0042 is.
alter table follow_ups add column if not exists agent_kind text;
alter table follow_ups add column if not exists targets_json text not null default '[]';
alter table follow_ups add column if not exists schedule text not null default '';
alter table follow_ups add column if not exists model_choice text not null default 'auto';
alter table follow_ups add column if not exists last_run_at timestamptz;
alter table follow_ups add column if not exists next_run_at timestamptz;
alter table follow_ups add column if not exists last_state text;
alter table follow_ups add column if not exists finding_json text not null default '{}';

-- Widened, never narrowed: see "WHY THE OLD COLUMNS STAY" above.
alter table follow_ups drop constraint if exists follow_ups_status_check;
alter table follow_ups add constraint follow_ups_status_check
  check (status in ('open', 'answered', 'dropped', 'active', 'paused', 'stopped', 'done'));

alter table follow_ups drop constraint if exists follow_ups_agent_kind_check;
alter table follow_ups add constraint follow_ups_agent_kind_check
  check (agent_kind in ('recheck', 'search', 'agenda'));

alter table follow_ups drop constraint if exists follow_ups_last_state_check;
alter table follow_ups add constraint follow_ups_last_state_check
  check (last_state in ('found', 'no-change', 'could-not-check', 'running', 'waiting'));

-- The scheduler's query: which active agents are due, oldest first.
create index if not exists follow_ups_newsroom_due
  on follow_ups (newsroom_id, status, next_run_at);

comment on column follow_ups.agent_kind is
  'recheck | search | agenda, or null for a manual row written before this migration. Text with a check, not an enum, so a fourth agent is not a type rewrite.';
comment on column follow_ups.targets_json is
  'JSON array of URL strings: pages to re-check, the body portal to watch, or optional seed links for a search. Empty is normal for search.';
comment on column follow_ups.schedule is
  '2h | 6h | 12h | daily | weekly | posting-days. The scheduler computes next_run_at from this; an unrecognised value never runs rather than running every tick.';
comment on column follow_ups.model_choice is
  'Per-follow-up model pick: a registry provider id, auto, or a custom:<uuid> connection. auto means the phase 5 order -- this row, then model_assignments job follow-up, then the surface default.';
comment on column follow_ups.last_state is
  'found | no-change | could-not-check | running | waiting. no-change and could-not-check are deliberately different: a quietly failing agent must not look like a quietly working one.';
comment on column follow_ups.finding_json is
  'The last run result: { title, summary, url, reason, checked_at, changed }. Drawn on the card and written to the story reporting notes. Never published from.';
