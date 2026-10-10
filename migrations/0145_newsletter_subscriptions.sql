-- Mailbox credentials are encrypted; messages retain existing archive provenance.
create table if not exists newsletter_mailboxes (
  newsroom_id integer primary key,
  user_id text not null,
  address text not null,
  host text not null default 'imap.hostinger.com',
  port integer not null default 993,
  ssl boolean not null default true,
  encrypted_password text,
  last_poll_at timestamptz,
  poll_claim_at timestamptz,
  last_error text,
  ignored_count integer not null default 0,
  cursor_uid bigint,
  cursor_uidvalidity bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists newsletter_messages (
  id serial primary key,
  newsroom_id integer not null,
  message_id text,
  sender text not null default '',
  subject text not null default '',
  source_id integer,
  version_id integer,
  capture_event_id integer,
  received_at timestamptz,
  -- The sanitised confirmation links retained for this message, stored so the
  -- Waiting list needs no re-parse and the scan has the anchors as captured.
  links jsonb not null default '[]'::jsonb,
  -- Set only when the message has reached the website scan; an un-scanned
  -- message's attachments are not yet part of any scan block.
  scanned_at timestamptz,
  created_at timestamptz not null default now()
);

-- One row per archived attachment of an accepted message (for example a PDF
-- packet). Maps the message to the artifact_version/capture_event the existing
-- extractor produced, so the scan can find a message's documents by message.
create table if not exists newsletter_attachments (
  id serial primary key,
  newsroom_id integer not null,
  message_id integer not null,
  version_id integer,
  capture_event_id integer,
  filename text not null default '',
  content_type text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists newsletter_attachments_message_idx
  on newsletter_attachments (newsroom_id, message_id);
-- UNIQUE per newsroom: the dedupe is a constraint, not a convention. A
-- partial index so the many messages the server left without a Message-ID
-- (message_id null) do not collide with each other.
create unique index if not exists newsletter_messages_dedupe_uidx
  on newsletter_messages (newsroom_id, message_id) where message_id is not null;
create index if not exists newsletter_messages_newsroom_idx
  on newsletter_messages (newsroom_id, created_at desc);

-- Source-level newsletter identity. Nullable, and that is the shape of the
-- data: every source that predates this file is an ordinary web page.
alter table sources add column if not exists newsletter_sender text;
alter table sources add column if not exists newsletter_signup_url text;
