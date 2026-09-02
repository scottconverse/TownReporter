-- Automatic can now fail over mid-run when the first provider's login has
-- lapsed (src/lib/news/automatic-failover.ts). That only applies to a job the
-- editor actually left on Automatic -- an explicit model choice never falls
-- back. `model_choice` on desk_jobs is overwritten with the CONCRETE choice
-- at commit time (see migrations/0025_model_choice.sql), so by the time a job
-- runs the row itself can no longer tell "Automatic picked this" from "the
-- editor picked this". This column remembers which one it was.
alter table desk_jobs
  add column if not exists model_choice_source text not null default 'editor';
