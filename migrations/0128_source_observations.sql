-- Source observations: a dated, scoped record of what the desk learned about a
-- source, so the next pass and the next story can be told "this source was
-- quiet", "this source refused us", "this source corrected a draft" -- instead
-- of the single `sources.last_error` string that only ever holds the MOST
-- RECENT attempt.
--
-- WHY A TABLE AND NOT MORE COLUMNS. `sources` carries one state; observations
-- are a HISTORY, one per check or one per editor correction, and they need a
-- date and a scope (which run, which lead, which claim). A column cannot hold a
-- history without either JSON nobody can query or a rewrite of the row every
-- pass.
--
-- WHY IT IS SAFE TO ADD. Nothing reads it yet; every existing row reads as "no
-- observations". The write path is off unless a caller records one.
--
-- THE OBSERVATION KINDS, as text (not an enum, for the reason 0097 gives -- the
-- vocabulary grows), and what each means:
--
--   changed            read cleanly and the page differed from last time.
--   quiet              read cleanly and nothing changed. NOT a failure.
--   retrieval-error    never reached the page (timeout/DNS/refused).
--   extraction-failure reached it but could not make text/leads.
--   asked-to-wait      the host said come back later (429/503).
--   blocked            the host refused us (401/403).
--   never-checked      accepted and not tried yet.
--   verified-claim     a story used this source to support a claim.
--   filled-gap         a story used this source to answer an open question.
--   corrected-draft    a story changed because of this source.
--   replaced           the editor replaced this source with another.
--
-- A CORRECTION IS AN OBSERVATION TOO, with `reversal_of` set to the observation
-- it corrects, so a wrong call ("this was quiet") can be reversed without
-- deleting the record that it was made.
--
-- SCOPING. `lead_id` and `claim_key` are nullable and carry NO foreign key, the
-- same call 0095 and 0097 made: a lead may be pruned and an observation that
-- lost its link would become an orphan nothing can explain. They are the "which
-- story" the editor needs to judge the note, not a constraint the database must
-- police.
create table if not exists source_observations (
  id serial primary key,
  newsroom_id integer not null,
  source_id integer not null references sources(id) on delete cascade,
  observed_on date not null default current_date,
  kind text not null,
  note text,
  lead_id integer,
  claim_key text,
  scan_run_id integer,
  observed_by text not null default 'system',
  reversal_of integer references source_observations(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists source_observations_source_idx
  on source_observations (newsroom_id, source_id, created_at desc);

create index if not exists source_observations_kind_idx
  on source_observations (newsroom_id, kind, created_at desc);
