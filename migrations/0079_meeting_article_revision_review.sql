-- Preserve the exact transcript evidence used at publication. Later transcript
-- revisions create review work; they never rewrite the published article or its
-- original evidence chain.
create table if not exists meeting_article_transcript_links (
  id serial primary key,
  newsroom_id integer not null,
  article_id integer not null references articles(id) on delete cascade,
  origin_draft_id integer references drafts(id) on delete set null,
  artifact_id integer not null references meeting_transcript_artifacts(id),
  artifact_sha256 text not null,
  video_id text not null,
  citation_snapshot text not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (newsroom_id, article_id, artifact_id)
);

create index if not exists meeting_article_transcript_links_video_idx
  on meeting_article_transcript_links (newsroom_id, video_id, artifact_id);

create table if not exists meeting_article_revision_reviews (
  id serial primary key,
  newsroom_id integer not null,
  article_link_id integer not null references meeting_article_transcript_links(id) on delete cascade,
  article_id integer not null references articles(id) on delete cascade,
  video_id text not null,
  prior_artifact_id integer not null references meeting_transcript_artifacts(id),
  current_artifact_id integer not null references meeting_transcript_artifacts(id),
  accepted_artifact_id integer references meeting_transcript_artifacts(id),
  correction_id integer references corrections(id) on delete set null,
  revision_reason text not null check (revision_reason in ('hash','revision-timestamp','duration')),
  status text not null default 'pending'
    check (status in ('pending','verified','correction-required','corrected')),
  resolved_by text,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_link_id, current_artifact_id)
);

create index if not exists meeting_article_revision_reviews_pending_idx
  on meeting_article_revision_reviews (newsroom_id, status, created_at desc);

-- One newsroom task per immutable meeting artifact and purpose. An unchanged
-- provisional recheck sees the same artifact and cannot file a duplicate lead.
alter table leads add column if not exists meeting_video_id text;
alter table leads add column if not exists meeting_artifact_id integer references meeting_transcript_artifacts(id);
alter table leads add column if not exists meeting_lead_purpose text;
create unique index if not exists leads_meeting_artifact_purpose_uidx
  on leads (newsroom_id, meeting_video_id, meeting_artifact_id, meeting_lead_purpose)
  where meeting_video_id is not null and meeting_artifact_id is not null and meeting_lead_purpose is not null;
