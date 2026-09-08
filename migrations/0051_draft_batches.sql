create table if not exists draft_batches (
  id serial primary key,
  newsroom_id integer not null references newsrooms(id),
  user_id text not null,
  runtime_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists draft_batches_newsroom_idx
  on draft_batches(newsroom_id, id desc);
alter table desk_jobs
  add column if not exists draft_batch_id integer;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'desk_jobs_draft_batch_fk'
  ) then
    alter table desk_jobs
      add constraint desk_jobs_draft_batch_fk
      foreign key (draft_batch_id) references draft_batches(id);
  end if;
end
$$;
create index if not exists desk_jobs_draft_batch_idx
  on desk_jobs(newsroom_id, draft_batch_id, id)
  where draft_batch_id is not null;
