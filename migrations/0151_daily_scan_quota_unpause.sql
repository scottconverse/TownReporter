-- D157 (Oct 19 2026): a usage limit no longer pauses the daily scan. Undo the
-- pauses that the old rule left behind, and only those: a policy paused for
-- any other reason (bad timezone, owner change, sources changed, or an
-- editor's own pause) keeps its pause.
update daily_scan_policies
   set paused = false,
       pause_reason = null,
       revision = revision + 1,
       updated_at = now()
 where paused = true
   and pause_reason = 'Subscription quota was reached. Resume manually after access is restored.';
