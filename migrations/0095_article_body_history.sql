-- The editor's body text and the correction that justified changing it (0.6.70).
--
-- A correction used to be a note above the story and nothing else: the printed
-- body was immutable, so a newsroom whose copy said "$4,200" when the fee was
-- $2,400 could print "we said $4,200, in fact it is $2,400" and leave the wrong
-- number standing in the story. Many newsrooms fix both. This is the record
-- that makes fixing the text safe to do.
--
-- WHY A HISTORY ROW RATHER THAN AN UPDATED_AT COLUMN. The paper's convention is
-- that a printed piece is corrected, never quietly changed. So the desk must be
-- able to answer "what did this story say when it printed, and who changed it?"
-- without keeping a second copy of every article anywhere. This is the same
-- shape and the same reasoning as `article_headline_history` (0093): append
-- only, read on the desk, never printed.
--
-- `correction_id` is what ties the two halves of one act together -- the note
-- the reader sees and the text the editor changed. It is nullable because a
-- body edit may be recorded for a story whose correction row was removed with
-- its article (the trash path), and because a row written before this release
-- has no correction at all. It carries no foreign key on purpose: corrections
-- are deleted with their article (delete-corrections-e2e), and a history that
-- silently disappeared with them would not be a history.
--
-- Additive and nullable-only: nothing existing is rewritten, and no reader
-- surface changes. The public page shows the correction exactly as it does
-- today, plus whatever the story's own text now says.
create table if not exists article_body_history (
  id serial primary key,
  newsroom_id integer not null,
  article_id integer not null,
  old_body text not null,
  new_body text not null,
  changed_by text not null,
  changed_at timestamptz not null default now(),
  correction_id integer
);
comment on table article_body_history is
  'Append-only record of every published-body edit made as part of a correction: the text before, the text after, who and when, and the correction that justified it. The article slug is untouched, so no link breaks.';
comment on column article_body_history.correction_id is
  'The corrections row published with this body edit. Null when the correction was removed with its article, or when the change was not made as part of a correction.';

create index if not exists article_body_history_article_idx
  on article_body_history (article_id, changed_at desc);
