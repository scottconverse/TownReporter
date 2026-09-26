-- The editor's headline and the editor's section, recorded (0.6.67).
--
-- Two things an editor owns that the desk used to overwrite or lose:
--
-- 1. A HEADLINE THE EDITOR WROTE. Every draft row is a revision log: a redraft
--    inserts a new row, so the model's new headline replaced the editor's
--    without anything noticing (lead 240: the scan headline was good and two
--    redrafts rewrote it worse). `headline_source` records who last decided
--    the headline on that row, and `model_headline` keeps what the model
--    wrote even when it did not win, so the desk can still show it.
--    `headline_source` defaults to 'model': every row written before this
--    migration was the model's (or an editor's edit of an untracked row, which
--    is indistinguishable and must not be presented as a tracked decision).
--
-- 2. THE SECTION THE MODEL PICKED. `drafts.topic` is what prints, and the
--    editor may have chosen it by hand. `model_topic` keeps the model's own
--    choice alongside it, which is what lets the desk say "the model filed
--    this under Council, you published it under Schools" -- and count it.
--
-- Nullable, no defaults, additive: an existing draft has no recorded model
-- headline or model topic, and NULL is the honest answer ("not recorded"), not
-- an empty string that would read as "the model wrote nothing".
alter table drafts add column if not exists model_headline text;
comment on column drafts.model_headline is
  'The headline the model wrote, kept even when headline holds the editor''s. Null = written before 0.6.67, not recorded.';

alter table drafts add column if not exists model_topic text;
comment on column drafts.model_topic is
  'The section the model chose, kept alongside topic (which is what prints and may be the editor''s). Null = written before 0.6.67, not recorded.';

alter table drafts add column if not exists headline_source text not null default 'model';
comment on column drafts.headline_source is
  'Who last decided this row''s headline: model or editor. Redraft keeps the editor''s headline when this reads editor.';

-- A published headline is an editor decision with a public consequence -- the
-- URL keeps its slug, so the page a reader has open changes under them the
-- moment it is saved. The paper's own record of who changed it and when, the
-- same shape as named_outlet_overrides: append-only, read on the desk, never
-- printed. `articles.headline` stays the single authority the public page, the
-- front page and the feed all read.
create table if not exists article_headline_history (
  id serial primary key,
  newsroom_id integer not null,
  article_id integer not null,
  old_headline text not null,
  new_headline text not null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);
comment on table article_headline_history is
  'Append-only record of every published-headline edit: the headline before, the headline after, who and when. The slug is untouched by any of these, so no link ever breaks.';

create index if not exists article_headline_history_article_idx
  on article_headline_history (article_id, changed_at desc);
