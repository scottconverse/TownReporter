create table if not exists xai_oauth_connections (
  newsroom_id integer primary key,
  encrypted_credential text,
  login_state text not null default 'signed_out',
  login_url text,
  login_code text,
  login_detail text,
  model_ids text not null default '[]',
  selected_model_id text,
  catalog_source text not null default 'fallback',
  updated_at timestamptz not null default now()
);
