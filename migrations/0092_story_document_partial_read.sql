-- A scanned document that a redraft could not finish inside its reading budget
-- keeps the pages it did read and records how many of them, so the desk can
-- name the document and say "12 of 13 pages" instead of telling the editor to
-- press Redraft again and hope.
--
-- Nullable on purpose: a document that was never partially read (still
-- uploaded, fully read, or failed before retaining a single page) has no
-- partial count, and 0 would be a lie about a document nobody has looked at.
-- Null means "not partially read", which is the honest answer and the one the
-- desk can show. The page count of the document is already in `pages`; for a
-- partial read `pages` is the document's total and `read_pages` is how many of
-- it are retained, so `read_pages < pages` is what marks the row partial.
alter table story_documents add column if not exists read_pages integer;
comment on column story_documents.read_pages is
  'Pages actually read and retained when a redraft stopped before the whole document. Null = not a partial read. read_pages < pages marks the row partial and enables "Read the rest".';
