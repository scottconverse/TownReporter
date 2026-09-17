-- Per-newsroom investigative date preferences and immutable per-round provenance.
alter table dark_settings add column if not exists research_preferences text not null default '{}';
alter table dark_runs add column if not exists research_preferences_json text;
alter table dark_runs add column if not exists verification_counts_json text;
