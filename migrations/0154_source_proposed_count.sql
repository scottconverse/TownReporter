-- D169 dynamic sources, spec 5f (Scott, Oct 20 2026: "ALL THREE AGREE").
-- A suggestion on a website the paper already has is attached to that source
-- instead of becoming a row of its own. This column counts those suggestions on
-- the source (the lowest-id accepted/trial/dormant row of the website).
-- Additive only; nothing is deleted.

alter table sources add column if not exists proposed_count integer not null default 0;
