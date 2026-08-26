-- Investigative freedom: reopen metadata, original blobs, pause vs close.

alter table investigations add column if not exists pause_reason text;
alter table frontier_items add column if not exists prior_status text;
alter table frontier_items add column if not exists reopened_at timestamptz;
alter table frontier_items add column if not exists reopened_from text;

create table if not exists artifact_blobs (
  id serial primary key,
  version_id integer not null,
  user_id text not null,
  sha256 text not null,
  mime text not null default 'application/octet-stream',
  original_url text not null default '',
  redirect_chain text not null default '[]',
  byte_length integer not null default 0,
  body_b64 text not null default '',
  captured_at timestamptz not null default now()
);
create index if not exists artifact_blobs_version_idx on artifact_blobs (version_id);
