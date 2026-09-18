-- Keep provider-login history immutable when a later signed-in probe resolves an
-- earlier failure. The failed row stays byte-for-byte intact; a distinct done
-- row points back to it, and the unique index makes resolution idempotent.
alter table provider_logins
  add column if not exists supersedes_login_id integer references provider_logins(id);

create unique index if not exists provider_logins_supersedes_login_id_key
  on provider_logins (supersedes_login_id)
  where supersedes_login_id is not null;
