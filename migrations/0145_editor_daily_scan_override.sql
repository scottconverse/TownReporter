-- Keep the previous build's cap and constraint intact for rollback.
-- Release G reads the explicit editor override; Release F keeps its bounded cap.
alter table daily_scan_policies add column if not exists source_cap_override integer;
