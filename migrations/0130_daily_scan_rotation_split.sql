alter table daily_scan_policies
  add column if not exists every_day_source_count integer not null default 8;
