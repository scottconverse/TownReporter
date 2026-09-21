-- Meeting-capture section 5: agenda-item chunks, alignments, and structured votes.
-- Additive only. Citations resolve to item + timestamp + excerpt + caption hash.
create table if not exists meeting_agenda_chunks (
  id serial primary key,
  newsroom_id integer not null,
  video_id text not null,
  artifact_id integer not null references meeting_transcript_artifacts(id) on delete cascade,
  item text not null,
  title text not null,
  start_seconds numeric not null,
  end_seconds numeric not null,
  segment_indexes text not null default '[]',
  created_at timestamptz not null default now(),
  unique (newsroom_id, video_id, item)
);

create index if not exists meeting_agenda_chunks_video_idx
  on meeting_agenda_chunks (newsroom_id, video_id);

create table if not exists meeting_alignments (
  id serial primary key,
  newsroom_id integer not null,
  video_id text not null,
  artifact_id integer not null references meeting_transcript_artifacts(id) on delete cascade,
  aligned boolean not null,
  reason text,
  packet_items text not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists meeting_alignments_video_idx
  on meeting_alignments (newsroom_id, video_id, created_at desc);

create table if not exists meeting_structured_votes (
  id serial primary key,
  newsroom_id integer not null,
  video_id text not null,
  item text not null,
  established boolean not null,
  motion text,
  mover text,
  seconder text,
  tally text,
  result text not null,
  source text,
  provenance text not null default '[]',
  disagreements text not null default '[]',
  created_at timestamptz not null default now(),
  unique (newsroom_id, video_id, item)
);

create index if not exists meeting_structured_votes_video_idx
  on meeting_structured_votes (newsroom_id, video_id);
