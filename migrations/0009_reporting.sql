-- Reader-facing provenance and story form.

alter table drafts add column if not exists provenance_json text not null default '[]';
alter table drafts add column if not exists form text not null default 'reported';
alter table drafts add column if not exists found_note text not null default '';
alter table drafts add column if not exists unanswered text not null default '[]';

alter table articles add column if not exists provenance_json text not null default '[]';
alter table articles add column if not exists form text not null default 'reported';
alter table articles add column if not exists found_note text not null default '';
alter table articles add column if not exists unanswered text not null default '[]';

update articles
set dek = 'The public record is only the beginning. TownReporter follows Longmont meetings, money and contracts — then keeps digging.',
    body = $welcome$TownReporter is a civic newsroom for Longmont, Colorado. The public site is the paper: reported stories, exact sources, and a record of what an editor chose to print.

The watch list is where reporting starts, not where it stops. TownReporter watches known civic sources, notices when documents change or disappear, follows names, contracts, packets and prior meetings, and keeps copies of what it finds. Dark Desk is the recursive investigative lane. A human editor still decides what publishes.

What we cover
City Council and study sessions. Planning, housing, and land use. NextLight and municipal utilities. St. Vrain Valley Schools when the record is public. Boulder County business that lands in Longmont.

What we will not do
We will not quote neighborhood apps as fact. We will not invent votes, dollar figures, or speakers. We will not hide a correction. We will not pretend a YouTube auto-caption is a verbatim transcript.

Free to reprint in whole or part with credit to TownReporter and a link back. Do not imply endorsement.$welcome$
where slug = 'welcome-to-townreporter' and user_id = 'masthead';
