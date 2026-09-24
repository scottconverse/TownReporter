alter table meeting_transcript_artifacts
  add column if not exists integrity_status text not null default 'unchecked'
    check (integrity_status in ('unchecked','valid','missing','hash-mismatch','sidecar-missing','sidecar-hash-mismatch','outside-root','ambiguous-path'));

alter table meeting_transcript_artifacts
  add column if not exists integrity_detail text;

alter table meeting_transcript_artifacts
  add column if not exists integrity_checked_at timestamptz;

create table if not exists meeting_artifact_storage_findings (
  id serial primary key,
  newsroom_id integer not null,
  artifact_id integer references meeting_transcript_artifacts(id) on delete set null,
  finding_kind text not null,
  original_path text not null,
  quarantine_path text,
  detail text not null,
  finding_key text not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists meeting_artifact_storage_findings_open_idx
  on meeting_artifact_storage_findings (newsroom_id, resolved_at, first_seen_at desc);
