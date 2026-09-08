create table if not exists routine_notice_checks (
  id serial primary key,
  newsroom_id integer not null references newsrooms(id) on delete cascade,
  request_id uuid not null,
  source_id integer not null references sources(id) on delete cascade,
  source_url_hash text not null,
  format_key text not null check (format_key in ('library-notice','parks-recreation-notice','community-arts-event-logistics','registration-deadline','waste-recycling-schedule','public-meeting-logistics')),
  policy_revision integer not null,
  capture_event_id integer references capture_events(id) on delete cascade,
  artifact_version_id integer references artifact_versions(id) on delete cascade,
  artifact_blob_id integer references artifact_blobs(id) on delete cascade,
  captured_content_hash text,
  captured_text_digest text,
  raw_blob_sha256 text,
  adapter_key text not null,
  adapter_version integer not null,
  state text not null check (state in ('parsed','parsed-with-conflicts','refused','capture-failed')),
  refusal_summary_json text not null default '[]',
  actor text not null,
  created_at timestamptz not null default now(),
  unique (newsroom_id, request_id)
);

create table if not exists routine_notice_candidate_refs (
  id serial primary key,
  check_id integer not null references routine_notice_checks(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  external_id_hash text not null,
  content_fingerprint text not null,
  outcome text not null check (outcome in ('parsed','conflict')),
  unique (check_id, ordinal)
);

create index if not exists routine_notice_checks_room_source_idx
  on routine_notice_checks(newsroom_id, source_id, format_key, id desc);
create index if not exists routine_notice_candidate_identity_idx
  on routine_notice_candidate_refs(external_id_hash, content_fingerprint);

create or replace function prevent_routine_notice_check_resurrection()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from legal_removal_urls u
    left join sources s on s.id=NEW.source_id and s.newsroom_id=NEW.newsroom_id
    left join capture_events ce on ce.id=NEW.capture_event_id and ce.newsroom_id=NEW.newsroom_id
    left join artifact_versions av on av.id=NEW.artifact_version_id and av.newsroom_id=NEW.newsroom_id
    left join artifact_blobs ab on ab.id=NEW.artifact_blob_id and ab.newsroom_id=NEW.newsroom_id
    where u.newsroom_id=NEW.newsroom_id and u.url_hash in (
      md5(legal_article_url_identity(s.url)), md5(legal_article_url_identity(ce.source_url)),
      md5(legal_article_url_identity(av.url)), md5(legal_article_url_identity(ab.original_url))
    )
  ) then
    raise exception 'This routine notice evidence is covered by a legal removal.';
  end if;
  return NEW;
end $$;

drop trigger if exists routine_notice_checks_legal_guard on routine_notice_checks;
create trigger routine_notice_checks_legal_guard
before insert or update on routine_notice_checks
for each row execute function prevent_routine_notice_check_resurrection();
