-- Owner rebrand (2026-09): the reader-facing org type changes from "civic"
-- to "non-profit". Production was already hand-edited (paper_settings'
-- masthead deck/banner, and this exact row's body/headline) -- this
-- migration exists so a FRESH install's seeded welcome article
-- (migrations/0002_newsroom.sql, updated again by 0009_reporting.sql,
-- slug 'welcome-to-townreporter') matches that live copy too. 0002 and
-- 0009 are already applied and immutable, so this is a forward migration
-- that UPDATEs the row rather than editing them.
--
-- Idempotent, and a no-op on production: the WHERE clause requires the OLD
-- 'civic' phrase still be present in the column being touched, so a second
-- run, or a run against a row someone already hand-edited to say
-- "non-profit", changes nothing. `replace()` only touches the exact old
-- phrase, leaving the rest of the copy (and any other use of the word
-- "civic", e.g. describing the subject matter rather than the org type)
-- untouched.
update articles
set body = replace(body, 'civic newsroom for Longmont', 'non-profit newsroom for Longmont'),
    headline = replace(headline, 'A civic paper for Longmont', 'A non-profit paper for Longmont')
where slug = 'welcome-to-townreporter'
  and (
    body like '%civic newsroom for Longmont%'
    or headline like '%A civic paper for Longmont%'
  );
