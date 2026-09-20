-- Meeting-capture N-1: operator enable/disable without deleting configuration.
-- Additive only. Default false so no existing install changes behavior silently;
-- an operator must explicitly turn the meetings step on.
alter table meeting_capture_settings
  add column if not exists enabled boolean not null default false;
