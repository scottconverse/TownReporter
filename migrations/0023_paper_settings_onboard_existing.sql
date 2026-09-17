-- CITY-SETUP release-walkthrough Blocker fix.
--
-- The live paper at townreporter.org predates the first-run setup screen and
-- has never run it, so its paper_settings row (if any) has onboarded = false
-- -- same as a database that has never been touched at all. Gating the
-- public site on onboarded=false alone would blank that real newspaper.
--
-- This is the one-time backfill that makes onboarded mean what the rest of
-- the app now assumes it means: any newsroom that already had an OWNER
-- (newsroom_members.role = 'owner') before this migration ran is an existing,
-- claimed install -- mark it onboarded so its public identity, nav links and
-- published articles keep rendering exactly as they do today. A newsroom
-- with no owner yet is genuinely unconfigured and stays onboarded = false.
-- DISTINCT matters: two owner rows for one newsroom would make this statement
-- touch the same conflict target twice, which Postgres refuses outright
-- ("ON CONFLICT DO UPDATE command cannot affect row a second time") -- a
-- migration that fails on exactly the installs it exists to protect.
insert into paper_settings (newsroom_id, onboarded)
select distinct newsroom_id, true
from newsroom_members
where role = 'owner'
on conflict (newsroom_id) do update set onboarded = true, updated_at = now();
