-- U28 (2026-09-30): the AI double-check behind the two chips that say "this
-- may already be the same story" -- the matcher's "possible" link
-- (`possible_duplicate_of`, migration 0031) and the "Looks already printed"
-- chip (`nearDuplicate`, 0.6.82/U26). See src/lib/news/dup-check.ts for the
-- question the desk asks and src/lib/news/desk-copy.ts's printedDupChip for
-- how the answer gates the chip.
--
-- Eight columns for one batched verdict per scan, which is more than the
-- desk's other receipts because a row can carry TWO independent borderline
-- pairs at once (a possible duplicate of an existing lead AND a chip against a
-- published story), and the stored answer has to say which of the two it is
-- about. Every column is nullable ON PURPOSE, and null means "the desk did not
-- ask": a scan whose check failed, timed out, or ran out of its pair budget
-- leaves nulls behind, the chip falls back to the word rule exactly as it did
-- before this unit, and nothing anywhere has to read a null as "the model said
-- no". That distinction is the whole safety property -- "no verdict" and "no"
-- must not be the same stored value, or a failed model call would start
-- silently clearing chips.
--
--   dup_ai_same / dup_ai_why / dup_ai_target
--     the verdict on the possible_duplicate_of link, its one-line reason, and
--     the headline it was about. `dup_ai_target` is kept even when the verdict
--     clears the link, so "why is this lead no longer linked?" has an answer
--     on the row rather than only in a log.
--   dup_ai_printed_same / dup_ai_printed_why / dup_ai_printed_slug
--     the same three for the "Looks already printed" chip. The slug is how the
--     read path knows the verdict is about the article the chip is showing:
--     nearDuplicate is re-run on every Queue read against a published list
--     that changes, so a verdict about one article must never gate a chip
--     about a different one.
--   dup_ai_model / dup_ai_checked_at
--     which model answered and when, once per checked row. The model is
--     reported by the transport rather than assumed, because Automatic
--     resolves to a rung that can change between scans.
--
-- No PGLite ensure-function counterpart is needed, for the reason 0031's own
-- comment gives: `leads` has no ensure* function guarding it, and the PGLite
-- fallback in src/lib/db.ts applies every file under migrations/*.sql itself
-- at startup. This file is the single schema source for both paths.
alter table leads add column if not exists dup_ai_same boolean;
alter table leads add column if not exists dup_ai_why text;
alter table leads add column if not exists dup_ai_target text;
alter table leads add column if not exists dup_ai_printed_same boolean;
alter table leads add column if not exists dup_ai_printed_why text;
alter table leads add column if not exists dup_ai_printed_slug text;
alter table leads add column if not exists dup_ai_model text;
alter table leads add column if not exists dup_ai_checked_at timestamptz;
