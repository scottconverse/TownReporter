-- MS-WIRE W2 (D201, Scott Oct 21 2026). The meeting writer (Scott's
-- report-local-news skill, run as an agent) ends its answer with the items a
-- person must check before the story prints -- a vote or a quote that rests
-- only on captions, a number read off a screen, a disputed figure, a sentence
-- with legal risk. They are editor-only: the Publish dialog lists them as a
-- warning the editor may publish over, and no public surface ever reads them.
-- Additive only; nothing is deleted.

alter table drafts add column if not exists editor_checks jsonb not null default '[]';

comment on column drafts.editor_checks is
  'The meeting writer''s pre-publication check list, one plain sentence per item. Editor-only: the publish warning counts these and no public surface reads them.';
