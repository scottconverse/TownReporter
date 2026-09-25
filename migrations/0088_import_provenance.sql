-- Imported stories: where a pasted report's story came from, and what line the
-- paper prints to say who wrote it.
--
-- Nullable on purpose, for the same reason 0087's transcript provenance is: a
-- scanner lead filed before this migration has no provenance, and a default
-- would claim one it does not have. Null means "not recorded", which is the
-- honest answer and the one the desk can show.
alter table leads add column if not exists origin text;
alter table leads add column if not exists provenance_json text;
comment on column leads.origin is
  'How this lead entered the desk. ''import'' = read out of a report the editor pasted. Null = not recorded (every lead filed before 0088, and every scanner lead, which is identified by scan_run_id).';
comment on column leads.provenance_json is
  'JSON provenance for an imported lead: {importer, importedAt, inputSha256, tool}. Null = not recorded.';

-- The line rides on the draft, the way form/found_note do, so it survives the
-- ordinary editor save and is what the publish path copies out. An imported
-- story whose draft says nothing gets the lead's own record (below).
alter table drafts add column if not exists disclosure_text text not null default '';
comment on column drafts.disclosure_text is
  'Reader-facing disclosure line chosen on the import review screen. Empty = fall back to the lead''s import provenance, then to the standard line from src/components/ai-disclosure.tsx.';

-- The disclosure line the article prints. Empty means "print the standard
-- AI-disclosure line", so nothing changes for a story that did not come in
-- through the import screen. An imported story whose report was written by an
-- outside research tool prints that fact instead, because the standard line
-- ("AI tools helped find records and write the first draft") would be false.
alter table articles add column if not exists disclosure_text text not null default '';
comment on column articles.disclosure_text is
  'Reader-facing disclosure line for this article. Empty = print the standard line from src/components/ai-disclosure.tsx. Set by the import review screen when an editor chose the wording.';
