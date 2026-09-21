-- Meeting-capture N-5: capture bounding (duration + size caps, per newsroom).
-- Additive only; defaults are stated and require Scott's confirmation.
--
-- Defaults and reasoning:
--   duration_cap_seconds = 28800 (8 hours): a long council/board session fits,
--     but an open-ended stream or a mis-listed 24h video is refused.
--   size_cap_bytes = 524288000 (500 MB): the M-1 audio proof was 266 MB for a
--     ~6.7h meeting (~40 MB/h); 500 MB leaves headroom for a long meeting's
--     audio while still refusing the unbounded 254 MB-class blowups that
--     motivated this item. Media retention of an 8h video would exceed this by
--     design -- that is the intended refusal, recorded with a reason.
alter table meeting_capture_settings
  add column if not exists duration_cap_seconds integer not null default 28800;
alter table meeting_capture_settings
  add column if not exists size_cap_bytes bigint not null default 524288000;

-- Record WHY a capture was refused by a cap (named reason, no silent truncation).
alter table meeting_capture_records
  add column if not exists refused_reason text;
