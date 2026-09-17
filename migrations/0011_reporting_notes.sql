-- Editor-only reporting notes on the lead. Never printed.
alter table leads add column if not exists notes_json text not null default '{}';
