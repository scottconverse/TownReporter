-- Sign-in attempts against the local writing-model CLIs (0.6.0).
--
-- One row per attempt: what was spawned, the authorize URL it printed, the
-- one-time code (Codex only), and how it ended. No credential ever lands
-- here -- the CLI writes its own file and owns its own refresh. `detail` is
-- redacted before it is written; see redactSecrets in
-- src/lib/news/provider-login.server.ts.
--
-- Runtime code keeps an idempotent ensure for the PGLite path
-- (ensureProviderLoginsSchema, mirroring ensureJobsSchema in
-- src/lib/news/jobs.ts); this migration is the real deployment's source of
-- truth. provider-login.test.ts asserts the two definitions agree.
create table if not exists provider_logins (
  id serial primary key,
  newsroom_id integer not null default 1,
  provider text not null,
  status text not null default 'starting',
  url text,
  code text,
  detail text not null default '',
  pid integer,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists provider_logins_open_idx
  on provider_logins (newsroom_id, provider, status, id desc);
