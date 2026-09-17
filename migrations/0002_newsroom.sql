create table if not exists sources (
  id serial primary key,
  user_id text not null,
  url text not null,
  title text not null,
  kind text not null default 'official',
  tier text not null default 'A',
  status text not null default 'accepted',
  last_hash text,
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);
create index if not exists sources_user_id_idx on sources (user_id);

create table if not exists snapshots (
  id serial primary key,
  user_id text not null,
  source_id integer not null references sources(id) on delete cascade,
  content_hash text not null,
  excerpt text not null,
  created_at timestamptz not null default now()
);

create table if not exists scan_runs (
  id serial primary key,
  user_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sources_fetched integer not null default 0,
  leads_created integer not null default 0,
  sources_proposed integer not null default 0,
  summary text,
  error text
);

create table if not exists leads (
  id serial primary key,
  user_id text not null,
  scan_run_id integer references scan_runs(id) on delete set null,
  headline text not null,
  why text not null,
  topic text not null default 'council',
  status text not null default 'new',
  source_urls text not null default '[]',
  evidence text,
  newsworthiness integer,
  created_at timestamptz not null default now()
);
create index if not exists leads_user_id_idx on leads (user_id);

create table if not exists drafts (
  id serial primary key,
  user_id text not null,
  lead_id integer not null references leads(id) on delete cascade,
  headline text not null,
  dek text not null default '',
  body text not null,
  topic text not null,
  source_urls text not null default '[]',
  integrity_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists articles (
  id serial primary key,
  user_id text not null,
  lead_id integer references leads(id) on delete set null,
  slug text not null unique,
  headline text not null,
  dek text not null default '',
  body text not null,
  topic text not null,
  source_urls text not null default '[]',
  status text not null default 'published',
  published_at timestamptz not null default now()
);
create index if not exists articles_published_idx on articles (status, published_at desc);

create table if not exists beat_memory (
  id serial primary key,
  user_id text not null,
  entity text not null,
  last_angle text not null,
  article_id integer references articles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists beat_memory_user_idx on beat_memory (user_id);

create table if not exists corrections (
  id serial primary key,
  user_id text not null,
  article_id integer references articles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists subscribers (
  id serial primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

insert into articles (user_id, slug, headline, dek, body, topic, source_urls, status)
values (
  'masthead',
  'welcome-to-townreporter',
  'A civic paper for Longmont, edited by a human',
  'TownReporter watches official records, drafts under wire-service rules, and publishes only what an editor signs.',
  $welcome$TownReporter is a small civic newspaper for Longmont, Colorado. It is not a newsletter mill and it is not an autonomous news robot.

The public site is the paper: headlines, recaps, corrections, and a permanent record of what we chose to print. Behind it sits a desk. An editor-in-chief signs in, points Grok at official sources, reviews every draft, and hits publish. Nothing on this masthead goes live because a model felt confident.

What we cover
City Council and study sessions. Planning, housing, and land use. NextLight and municipal utilities. St. Vrain Valley Schools when the record is public. Boulder County business that lands in Longmont. Public meetings, packets, and notices — the documents most people never open.

What we will not do
We will not quote neighborhood apps as fact. We will not invent votes, dollar figures, or speakers. We will not hide a correction. We will not pretend a YouTube auto-caption is a verbatim transcript; captions are a map of topics, and quotes get checked.

How a story gets here
The editor keeps a source list. On Scan, Grok fetches those pages, compares them to the last snapshot, and files leads. On Draft, it writes a recap with attributed claims and named sources. The editor edits, holds, kills, or publishes. Beat memory records what already ran so the next scan does not reprint yesterday as news.

This first item is the paper introducing itself. The next items will be reported from the live public record, by an editor who can still say no.$welcome$,
  'about',
  '[]',
  'published'
);
