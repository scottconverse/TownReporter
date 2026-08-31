-- Editor invites (v0.5.3): the one keyed door through the claimed-desk wall.
-- The owner mints a one-time link for a named email address; the stored value
-- is a SHA-256 of the token, so a database read hands out no live links.
-- Runtime code keeps an idempotent ensure for the PGLite preview; this
-- migration is the real deployment's source of truth, same as every table.
create table if not exists editor_invites (
  id serial primary key,
  newsroom_id integer not null default 1,
  email text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
