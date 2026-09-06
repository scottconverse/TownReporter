-- Direction A, stage 1: the Follow-ups object (docs/design/DIRECTION-A-BUILD-NOTES-2026-09-06.md).
--
-- Today, "who still needs to reply to us" lives only as free-text lines
-- inside a story's reporting notes. This gives it one real, newsroom-scoped
-- place: the rail's "Follow-ups" block and /desk/follow-ups. Forward
-- migration only (new table, nothing destructive).
create table if not exists follow_ups (
  id serial primary key,
  newsroom_id integer not null default 1,
  user_id text not null,
  lead_id integer,
  article_id integer,
  who text not null,
  what text not null,
  due_on date,
  status text not null default 'open' check (status in ('open', 'answered', 'dropped')),
  nudged_at timestamptz,
  answered_at timestamptz,
  reply_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists follow_ups_newsroom_status_due
  on follow_ups (newsroom_id, status, due_on);
