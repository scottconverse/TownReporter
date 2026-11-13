create table if not exists townrecord_handoffs (
  newsroom_id integer not null,
  instance_id text not null,
  meeting_id integer not null,
  revision integer not null,
  package_hash text not null,
  package_json text not null,
  lead_id integer references leads(id),
  version_id integer,
  capture_event_id integer,
  received_at timestamptz not null default now(),
  primary key(newsroom_id,instance_id,meeting_id,revision)
);

