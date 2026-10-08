-- Keep YouTube 429 retries slow and bounded without losing the next-try time.
alter table meeting_capture_records
  add column if not exists youtube_retry_day date;

alter table meeting_capture_records
  add column if not exists youtube_retry_count integer not null default 0
    check (youtube_retry_count between 0 and 3);

alter table meeting_capture_records
  add column if not exists youtube_retry_at timestamptz;
