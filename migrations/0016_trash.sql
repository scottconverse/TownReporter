-- Deleting was permanent, and delete is one click away from the whole desk.
--
-- The operator's rule is that an editor can always remove something, before or
-- after it prints. That rule is right and it needs a floor under it: a lead
-- takes its drafts with it, and an editorial draft has no copy anywhere, so a
-- mis-click used to be final.
--
-- This holds a snapshot of what was removed, and enough of its dependents to
-- put it back: a lead with its drafts, an article with its corrections, an
-- editorial draft with its extras.
--
-- Snapshot-and-remove rather than a `deleted_at` flag on each table. A flag
-- means every list, every feed, the sitemap and the public article route must
-- all remember to filter, and the one that forgets serves something the editor
-- believes is gone. Here the row really is deleted; nothing can leak.

create table if not exists deleted_items (
  id serial primary key,
  newsroom_id integer not null default 1,
  -- lead | draft | article
  kind text not null,
  -- The original row id, so a restore goes back to the same id and anything
  -- still pointing at it lines up again.
  ref_id integer not null,
  -- What the editor will recognise in the list.
  label text not null default '',
  -- The row itself, plus its dependents, as JSON.
  payload text not null,
  deleted_by text not null default '',
  deleted_at timestamptz not null default now()
);

create index if not exists deleted_items_newsroom_time
  on deleted_items (newsroom_id, deleted_at desc);
