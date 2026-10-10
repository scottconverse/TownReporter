-- Daily source limits are editor warnings, not a database refusal.
alter table daily_scan_policies drop constraint if exists daily_scan_policies_source_cap_check;
