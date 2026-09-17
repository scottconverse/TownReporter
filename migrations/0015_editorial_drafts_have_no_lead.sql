-- An editorial has no lead, and drafts.lead_id was not null.
--
-- Every draft used to begin as a lead, so the column was declared not null in
-- 0002. An editorial does not: an editor types a subject, or pastes a URL, and
-- the Opinion desk writes the paper's own position. Nothing files a lead for
-- it, and filing one would put an unsigned editorial in the news queue, which
-- is the one thing that desk exists to avoid.
--
-- The effect was total. Every editorial the writer finished hit
--   null value in column "lead_id" of relation "drafts"
-- at the moment it was filed, so the Opinion desk could never have produced a
-- draft even when the model returned a good piece in time. The two failures
-- visible on the desk were timeouts; this one was waiting behind them.
--
-- Nothing reads the column expecting a value: every query filters
-- `where lead_id = <id>`, which a null simply never matches. articles.lead_id
-- has been nullable since 0002.

alter table drafts alter column lead_id drop not null;
