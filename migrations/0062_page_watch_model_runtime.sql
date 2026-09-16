-- Keep deploy-created source_monitors aligned with ensurePageWatchSchema.
alter table source_monitors add column if not exists watch_model_effort text;
alter table source_monitors add column if not exists watch_model_requested text;
alter table source_monitors add column if not exists watch_failover_note text not null default '';
