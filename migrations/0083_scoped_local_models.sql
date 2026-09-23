-- A newsroom can choose different Ollama or on-device models for each job.
-- Existing provider_settings.local_model_* remains the legacy fallback.
create table if not exists newsroom_local_model_choices (
  newsroom_id integer not null references newsrooms(id) on delete cascade,
  scope text not null check (scope in ('story', 'scan', 'opinion', 'dark', 'forced')),
  base_url text not null,
  model_id text not null,
  updated_at timestamptz not null default now(),
  primary key (newsroom_id, scope)
);
