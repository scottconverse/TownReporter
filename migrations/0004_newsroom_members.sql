create table if not exists newsroom_members (
  user_id text primary key,
  role text not null,
  created_at timestamptz not null default now()
);
