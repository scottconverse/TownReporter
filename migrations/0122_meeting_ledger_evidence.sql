-- WR1 fixes round 1: the ledger's evidence, the votes it found, and the
-- newsroom's own list of elected officials and staff.
--
-- WHY THIS EXISTS. The first real runs on the dev copy wrote a ledger of 308
-- rows for one four-hour council session. That is the raw inventory -- every
-- motion, figure and remark the reading pass noticed -- not a ledger an editor
-- can read or a writer can reason over, and because each raw row was its own
-- row, nothing recorded which of them belonged to the same agenda item. The
-- grouping the writer now does in code (buildLedger in meeting-whole.ts) turns
-- that inventory into one ledger item per agenda item plus one per standalone
-- event, and the raw rows it grouped are kept here verbatim so the panel can
-- open an item and see exactly what was read to produce it. Nothing the first
-- run found is thrown away by the second.
--
-- The vote columns are the same story. The tape says "carries 5 to two" and
-- the writer's own scan finds those result phrases; storing the result and the
-- tally on the item lets the writer be given the vote as a fact rather than
-- left to infer one from the motion's existence, and lets the claims check
-- flag a vote word in the draft that matches no result the tape recorded.
--
-- FOUR ADDITIVE COLUMNS ON `meeting_ledger_items` (migrations-only table; no
-- ensure counterpart, see the note in schema-parity.test.ts):
--
--   evidence     the raw inventory entries this ledger item grouped, as an
--                array of { kind, text, who, startSeconds, packetPage,
--                numbers, sourceExcerpt }. Empty for a ledger item that was
--                never a group of raw rows (an unread window).
--   end_seconds  the end of the item's span on the tape, so a group can say
--                "Discussion from 1:04:30–1:22:00" and a vote can be attached
--                to the item whose span contains it. Null where the item is a
--                single moment.
--   vote_result  the result phrase the scan found for this item ("carries",
--                "fails", "unanimous" ...). Empty when the tape recorded none.
--   vote_tally   the tally the scan found, normalized "N-N" ("5-2"). Empty
--                when the tape recorded none.
--
-- ONE NEW COLUMN ON `paper_settings`:
--
--   elected_officials  the newsroom's own list of the people who appear in its
--                meeting captions -- one name and title per line, plain text,
--                edited on the existing city/sources setup screen. The
--                captions garble surnames ("Christ" for Crist, "Koffer" for
--                Kalkhofer, "Marcin" for Marsing, "Prito" for Prieto) and the
--                writer corrects a caption name against this list before it
--                writes. Empty is a real answer: a newsroom that has not
--                written its list still gets the packet and entity names, and
--                an uncorrected caption name is flagged rather than guessed.
--
-- `paper_settings` IS ensure-created, so this column is mirrored in
-- PAPER_SETTINGS_SCHEMA (paper-settings.ts) for the PGLite/unit-test path,
-- exactly as editor_email and named_outlets are; the parity test requires both
-- sides to agree.

alter table meeting_ledger_items
  add column if not exists evidence jsonb not null default '[]'::jsonb;
comment on column meeting_ledger_items.evidence is
  'The raw inventory entries this ledger item grouped, as JSON. Empty for an item that was never a group of raw rows (an unread window).';

alter table meeting_ledger_items add column if not exists end_seconds integer;
comment on column meeting_ledger_items.end_seconds is
  'End of the item''s span on the tape in seconds, so a group can state its range and a vote can attach to the item whose span contains it. Null for a single moment.';

alter table meeting_ledger_items add column if not exists vote_result text not null default '';
comment on column meeting_ledger_items.vote_result is
  'The result phrase the writer''s scan found on the tape for this item ("carries", "fails", "unanimous"). Empty when the tape recorded none.';

alter table meeting_ledger_items add column if not exists vote_tally text not null default '';
comment on column meeting_ledger_items.vote_tally is
  'The tally the writer''s scan found, normalized "N-N" ("5-2"). Empty when the tape recorded none.';

alter table paper_settings add column if not exists elected_officials text;
comment on column paper_settings.elected_officials is
  'The newsroom''s list of elected officials and staff, one name and title per line. Used to correct garbled caption names before the whole-meeting writer runs. NULL = never set; empty string = set to nothing.';
