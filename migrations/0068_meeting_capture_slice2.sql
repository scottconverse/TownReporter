-- Meeting-capture Slice 2: caption artifact metadata on the authoritative record.
-- Additive only. The database row remains the source of truth; the archive file
-- is still a regenerable yt-dlp cache.
alter table meeting_capture_records add column if not exists caption_path text;
alter table meeting_capture_records add column if not exists caption_format text;
alter table meeting_capture_records add column if not exists caption_sha256 text;
alter table meeting_capture_records add column if not exists caption_captured_at timestamptz;
