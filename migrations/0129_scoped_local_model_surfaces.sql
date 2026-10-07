create table if not exists newsroom_local_model_choices_additional (
  newsroom_id integer not null references newsrooms(id) on delete cascade,
  scope text not null check (scope in ('follow-up', 'ocr')),
  base_url text not null,
  model_id text not null,
  updated_at timestamptz not null default now(),
  primary key (newsroom_id, scope)
);
