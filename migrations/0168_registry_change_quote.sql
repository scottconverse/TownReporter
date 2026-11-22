/*
  Scott, Nov 20 2026: every proposal on the desk must show the sentence from the
  source page that states the change, not just a summary the model wrote. The
  scan now asks for that sentence and stores it on the change row.

  Additive only: one nullable column, nothing dropped or rewritten. A proposal
  stored before this migration has no quote, and the desk says so instead of
  inventing one.
*/
set local lock_timeout = '3s';

alter table resource_changes add column if not exists evidence_quote text;

comment on column resource_changes.evidence_quote is
  'The sentence, copied from the source page, that states the change. Null when the scan did not record one.';
