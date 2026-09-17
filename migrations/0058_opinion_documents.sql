create table if not exists story_documents (
  id text primary key, newsroom_id integer not null, user_id text not null,
  lead_id integer references leads(id) on delete cascade,
  editorial_request_id integer references editorial_requests(id) on delete set null,
  filename text not null, mime text not null, original bytea not null,
  full_text text, evidence text, status text not null default 'uploaded',
  detail text not null default '', pages integer,
  read_parts integer not null default 0, total_parts integer not null default 0,
  source_url text, expected_size integer,
  created_at timestamptz not null default now()
);

alter table story_documents add column if not exists editorial_request_id integer;

do $$ begin
  alter table story_documents add constraint story_documents_editorial_request_id_fkey
    foreign key (editorial_request_id) references editorial_requests(id) on delete set null;
exception when duplicate_object then null;
end $$;
