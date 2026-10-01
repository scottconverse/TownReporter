-- SH-B (2026-10-01): being polite, and actually coming back when a site asks
-- us to. A "come back later" is the one refusal that is not a failure -- the
-- site is telling us it will talk to us, just not now -- and before this there
-- was nowhere to put that answer, so the desk did the rudest possible thing
-- with it: retried the same host 400 ms later, twice, then wrote "Could not
-- check" on the row as if the site were broken.
--
-- WHAT THESE COLUMNS HOLD, on `sources`:
--
--   retry_after       when we may ask again. Non-null means the row is PARKED:
--                     the scan skips it until that moment, and the unattended
--                     scheduler or the next pass picks it up once it passes.
--                     This is the difference between honouring "come back
--                     later" and merely recording it.
--   retry_after_note  the plain sentence the Sources row prints ("Asked us to
--                     come back at 3:40 PM"), stored rather than recomputed
--                     because the reason we were given is evidence about the
--                     site, and evidence belongs on the row.
--   blocked_at        when the host first refused *us* (401/403/bot wall), as
--                     opposed to asking us to wait. Null means not blocked.
--   blocked_attempts  how many times in a row we have been blocked. This is
--                     what the backoff is read from -- next pass, then 6 h,
--                     then 24 h -- so the second refusal waits longer than the
--                     first without anyone having to remember a schedule.
--
-- Two nullable timestamps and two counters, all defaulted, so every existing
-- row reads "never blocked, never asked to wait" and nothing has to be
-- backfilled: a wait the desk did not observe is not a wait it may claim.
--
-- AND THE PER-HOST DAILY CAP, which is not a property of any one source. A
-- newsroom can watch six pages of the same city site, and a cap counted per
-- source would let each of them have its own full allowance -- six times the
-- traffic to one host, which is exactly the thing being prevented. So the
-- count lives in its own small table keyed by host, and the scan reads it
-- before it fetches and adds to it when a host refuses us. `day` is in the key
-- so yesterday's refusals do not silence today's, and the row is deliberately
-- left behind rather than deleted: "we tried four times and gave up" is worth
-- being able to read.
--
-- No PGLite ensure-function counterpart is needed, for the reason 0113's own
-- comment gives: the PGLite fallback in src/lib/db.ts applies every file under
-- migrations/*.sql itself at startup, so this file is the single schema source
-- for both paths.
alter table sources add column if not exists retry_after timestamptz;
alter table sources add column if not exists retry_after_note text;
alter table sources add column if not exists blocked_at timestamptz;
alter table sources add column if not exists blocked_attempts integer not null default 0;

create table if not exists source_host_tries (
  newsroom_id integer not null,
  host text not null,
  day date not null,
  tries integer not null default 0,
  primary key (newsroom_id, host, day)
);
