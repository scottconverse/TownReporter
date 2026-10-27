-- DEF-1 (Scott Oct 26 2026: "agreed. show it on the desk only."). Search by
-- meaning over the paper's OWN published stories and over the text of files an
-- editor uploaded with "Add documents". Same engine as 0156 (MiniLM, 384
-- numbers); this table adds the two things 0156 cannot hold.
--
-- One row per piece of one owner:
--   kind='article'   owner_id = articles.id as text.  part 0 = headline + summary,
--                    parts 1.. = the body, a few paragraphs at a time.
--   kind='document'  owner_id = story_documents.id.   parts 0.. = the file's text.
--   part = -1        a marker: the owner has no usable text, so the background
--                    fill does not look at it again. Its vector is empty.
-- source_md5 is the md5 of the text the parts were cut from, so an edited story
-- or a re-read file is noticed and re-embedded.
--
-- Deliberately NO text and NO url here, like 0156: the vectors cannot become a
-- second copy of a story that a legal removal or an unpublish would have to
-- chase. Every search joins the owner back to the live row (articles with
-- status='published' in the caller's newsroom, story_documents still present),
-- so an unpublished or deleted owner drops out of the very next search; the
-- hourly prune then removes its rows.
--
-- Additive only: one new table, no foreign key (so no lock on `articles` or
-- `story_documents`), nothing altered or deleted. The migration runs in one
-- transaction; if another session holds the catalog for more than 3 seconds
-- it fails fast and can simply be run again instead of waiting in line behind
-- the live paper.

set local lock_timeout = '3s';

create table if not exists story_meaning_vectors (
  kind text not null check (kind in ('article', 'document')),
  owner_id text not null,
  part integer not null,
  source_md5 text not null,
  model text not null,
  dims integer not null,
  vector bytea not null,
  created_at timestamptz not null default now(),
  primary key (kind, owner_id, part)
);

comment on table story_meaning_vectors is
  'Search by meaning over our own published stories and uploaded files (DEF-1): (kind, owner_id, part) -> normalized 384-dim MiniLM vector, little-endian float32. No text and no url are stored; searches join back to the live articles / story_documents row and the background prune removes rows whose owner is gone.';
