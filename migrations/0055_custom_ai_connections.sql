-- Optional editor-managed OpenAI-compatible endpoints. API keys are encrypted
-- by the server before insertion and are never returned through a client DTO.
create table if not exists custom_ai_connections (
  id text primary key,
  newsroom_id integer not null,
  name text not null,
  base_url text not null,
  encrypted_api_key text,
  model_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, name)
);
