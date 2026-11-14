/*
  A lead's newsworthiness in four parts (src/lib/news/lead-score.ts):
  immediacy, impact, conflict and novelty, 1 to 5 each, with one short reason
  each. The model gives the parts and the desk adds them, so `newsworthiness`
  stays the total (4 to 20) and every sort and color rule keeps working.

  Null is right for every lead filed before this column existed and for every
  lead scored as one number, so nothing here backfills: an old score is not
  split into parts nobody gave.
*/
alter table leads add column if not exists score_parts jsonb;
