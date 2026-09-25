-- The revision token the outlet-list editor applies against (0.6.63, Unit W).
--
-- The owner's Server page now edits paper_settings.named_outlets (0088) the way
-- it edits the section list, and the section list has carried a revision for
-- exactly this reason: two people with the page open, or one stale tab, would
-- otherwise overwrite each other's list with no refusal. Applying compares the
-- revision the editor loaded against this column and refuses on a mismatch
-- ("The outlet list changed while you were editing"), then increments it.
--
-- An integer rather than the row's updated_at: the editor sends its revision
-- back through JSON, and a Date round-tripped that way has lost the
-- sub-millisecond precision the database column keeps, so an equality compare
-- against updated_at could never match. Mirrors section_config.revision.
--
-- Existing installs keep revision 0 and are unaffected -- the column only
-- guards a change made through the new panel.
alter table paper_settings
  add column if not exists named_outlets_revision integer not null default 0;
