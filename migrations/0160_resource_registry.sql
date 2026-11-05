-- NAV-P1 (Scott, Nov 5 2026: Community Navigator Phase 1, slice 1). The
-- resource registry: an Open Referral HSDS 3.0 store plus the tables that
-- record where a row came from and what a later scan proposes to change.
--
-- Additive only. Every table is "create table if not exists" and no existing
-- table or column is touched. No plain table name here collides with an
-- earlier migration, so the HSDS entity names are used verbatim (section 7.3:
-- field names are used as HSDS names them).
--
-- Imported rows start unpublished (spec 15.1). Every data table carries
-- published boolean not null default false.
--
-- The deploy applier wraps a file in a transaction; a busy catalog wait fails
-- in three seconds and can be retried.

set local lock_timeout = '3s';

-- 13.2 TownReporter's own tables. Created first so every HSDS table can point
-- at the import that produced it.

create table if not exists resource_imports (
  id bigserial primary key,
  newsroom_id integer not null,
  directory_name text not null,
  format text not null check (format in ('json', 'csv')),
  source_url text,
  imported_at timestamptz not null default now(),
  record_counts jsonb not null default '{}'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  report text
);

create index if not exists resource_imports_newsroom_idx
  on resource_imports (newsroom_id);

create table if not exists resource_sources (
  id serial primary key,
  newsroom_id integer not null,
  source_id integer not null references sources(id) on delete cascade,
  registry_role text not null
    check (registry_role in ('organization', 'service', 'location', 'directory')),
  directory_name text,
  created_at timestamptz not null default now(),
  unique (newsroom_id, source_id, registry_role)
);

create index if not exists resource_sources_newsroom_idx
  on resource_sources (newsroom_id);

-- 13.1 HSDS core tables.
--
-- Every row also carries: hsds_id (the identifier the directory published),
-- directory_name (so two directories that both number their records from 1
-- do not collide), published, resource_import_id, created_at/updated_at.
-- The unique key (newsroom_id, directory_name, hsds_id) is what makes a
-- re-import an update rather than a duplicate.
--
-- Composite foreign keys (13.3) make a child and its parent share one
-- newsroom_id; that is why each parent also declares unique (id, newsroom_id).

create table if not exists taxonomies (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  name text not null,
  parent_id integer,
  published boolean not null default false,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  -- Column-list SET NULL (Postgres 15+): a bare `on delete set null` would
  -- null BOTH columns, and newsroom_id is NOT NULL, so deleting a parent
  -- taxonomy would fail instead of clearing the child's link. Only the
  -- referencing column is cleared; the row keeps its newsroom.
  foreign key (parent_id, newsroom_id) references taxonomies (id, newsroom_id)
    on delete set null (parent_id)
);

create index if not exists taxonomies_newsroom_idx on taxonomies (newsroom_id);

create table if not exists organizations (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  user_id text not null default '',
  name text not null,
  alternate_name text,
  description text,
  email text,
  website text,
  legal_status text,
  status text not null default 'unverified'
    check (status in ('active', 'inactive', 'unverified')),
  published boolean not null default false,
  source_id integer references sources(id) on delete set null,
  source_capture_id integer references snapshots(id) on delete set null,
  last_verified_at timestamptz,
  verification_method text
    check (verification_method in ('scan', 'editor', 'org-confirmed', 'imported')),
  last_verified_by text,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id)
);

create index if not exists organizations_newsroom_idx
  on organizations (newsroom_id);
create index if not exists organizations_published_idx
  on organizations (newsroom_id, published);

create table if not exists services (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  organization_id integer not null,
  name text not null,
  description text,
  url text,
  status text not null default 'unverified'
    check (status in ('active', 'inactive', 'unverified')),
  taxonomy_id integer,
  fees text,
  application_process text,
  crisis boolean not null default false,
  published boolean not null default false,
  source_id integer references sources(id) on delete set null,
  source_capture_id integer references snapshots(id) on delete set null,
  last_verified_at timestamptz,
  verification_method text
    check (verification_method in ('scan', 'editor', 'org-confirmed', 'imported')),
  last_verified_by text,
  field_provenance jsonb not null default '{}'::jsonb,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  foreign key (organization_id, newsroom_id) references organizations (id, newsroom_id)
    on delete cascade,
  foreign key (taxonomy_id, newsroom_id) references taxonomies (id, newsroom_id)
    on delete set null (taxonomy_id)
);

create index if not exists services_newsroom_idx on services (newsroom_id);
create index if not exists services_organization_idx
  on services (organization_id, newsroom_id);
create index if not exists services_published_idx on services (newsroom_id, published);

create table if not exists locations (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  organization_id integer not null,
  name text,
  description text,
  address_1 text,
  address_2 text,
  city text,
  state_province text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  accessibility_notes text,
  transportation_notes text,
  status text not null default 'unverified'
    check (status in ('active', 'inactive', 'unverified')),
  published boolean not null default false,
  source_id integer references sources(id) on delete set null,
  source_capture_id integer references snapshots(id) on delete set null,
  last_verified_at timestamptz,
  verification_method text
    check (verification_method in ('scan', 'editor', 'org-confirmed', 'imported')),
  last_verified_by text,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  foreign key (organization_id, newsroom_id) references organizations (id, newsroom_id)
    on delete cascade
);

create index if not exists locations_newsroom_idx on locations (newsroom_id);
create index if not exists locations_organization_idx
  on locations (organization_id, newsroom_id);
create index if not exists locations_published_idx on locations (newsroom_id, published);

-- A schedule carries the service and/or location it belongs to, exactly as
-- HSDS does, so a bundle can be rebuilt with the same nesting it arrived in.
create table if not exists schedules (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  service_id integer,
  location_id integer,
  by_appointment boolean not null default false,
  days text,
  opens_at text,
  closes_at text,
  notes text,
  published boolean not null default false,
  source_id integer references sources(id) on delete set null,
  source_capture_id integer references snapshots(id) on delete set null,
  last_verified_at timestamptz,
  verification_method text
    check (verification_method in ('scan', 'editor', 'org-confirmed', 'imported')),
  last_verified_by text,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  foreign key (service_id, newsroom_id) references services (id, newsroom_id)
    on delete cascade,
  foreign key (location_id, newsroom_id) references locations (id, newsroom_id)
    on delete cascade
);

create index if not exists schedules_newsroom_idx on schedules (newsroom_id);
create index if not exists schedules_service_idx on schedules (service_id, newsroom_id);
create index if not exists schedules_location_idx on schedules (location_id, newsroom_id);

create table if not exists service_at_locations (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  service_id integer not null,
  location_id integer not null,
  description text,
  schedule_id integer,
  published boolean not null default false,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  foreign key (service_id, newsroom_id) references services (id, newsroom_id)
    on delete cascade,
  foreign key (location_id, newsroom_id) references locations (id, newsroom_id)
    on delete cascade,
  foreign key (schedule_id, newsroom_id) references schedules (id, newsroom_id)
    on delete set null (schedule_id)
);

create index if not exists service_at_locations_newsroom_idx
  on service_at_locations (newsroom_id);
create index if not exists service_at_locations_service_idx
  on service_at_locations (service_id, newsroom_id);
create index if not exists service_at_locations_location_idx
  on service_at_locations (location_id, newsroom_id);

-- HSDS phones hang off an organization, a service, or a location. At least
-- one of the three must be named.
create table if not exists contacts (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  organization_id integer,
  service_id integer,
  location_id integer,
  name text,
  role text,
  department text,
  phone text,
  phone_extension text,
  email text,
  website text,
  published boolean not null default false,
  source_id integer references sources(id) on delete set null,
  source_capture_id integer references snapshots(id) on delete set null,
  last_verified_at timestamptz,
  verification_method text
    check (verification_method in ('scan', 'editor', 'org-confirmed', 'imported')),
  last_verified_by text,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  check (organization_id is not null or service_id is not null or location_id is not null),
  foreign key (organization_id, newsroom_id) references organizations (id, newsroom_id)
    on delete cascade,
  foreign key (service_id, newsroom_id) references services (id, newsroom_id)
    on delete cascade,
  foreign key (location_id, newsroom_id) references locations (id, newsroom_id)
    on delete cascade
);

create index if not exists contacts_newsroom_idx on contacts (newsroom_id);
create index if not exists contacts_organization_idx
  on contacts (organization_id, newsroom_id);
create index if not exists contacts_service_idx on contacts (service_id, newsroom_id);
create index if not exists contacts_location_idx on contacts (location_id, newsroom_id);

create table if not exists eligibilities (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  service_id integer not null,
  description text,
  criteria jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  source_id integer references sources(id) on delete set null,
  source_capture_id integer references snapshots(id) on delete set null,
  last_verified_at timestamptz,
  verification_method text
    check (verification_method in ('scan', 'editor', 'org-confirmed', 'imported')),
  last_verified_by text,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  foreign key (service_id, newsroom_id) references services (id, newsroom_id)
    on delete cascade
);

create index if not exists eligibilities_newsroom_idx on eligibilities (newsroom_id);
create index if not exists eligibilities_service_idx
  on eligibilities (service_id, newsroom_id);

create table if not exists required_documents (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  service_id integer not null,
  document text not null,
  description text,
  required boolean not null default true,
  published boolean not null default false,
  source_id integer references sources(id) on delete set null,
  source_capture_id integer references snapshots(id) on delete set null,
  last_verified_at timestamptz,
  verification_method text
    check (verification_method in ('scan', 'editor', 'org-confirmed', 'imported')),
  last_verified_by text,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  foreign key (service_id, newsroom_id) references services (id, newsroom_id)
    on delete cascade
);

create index if not exists required_documents_newsroom_idx
  on required_documents (newsroom_id);
create index if not exists required_documents_service_idx
  on required_documents (service_id, newsroom_id);

create table if not exists languages (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  service_id integer not null,
  language text not null,
  note text,
  published boolean not null default false,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  foreign key (service_id, newsroom_id) references services (id, newsroom_id)
    on delete cascade
);

create index if not exists languages_newsroom_idx on languages (newsroom_id);
create index if not exists languages_service_idx on languages (service_id, newsroom_id);

create table if not exists accessibilities (
  id serial primary key,
  newsroom_id integer not null,
  hsds_id text not null,
  directory_name text not null default '',
  service_id integer,
  location_id integer,
  accessibility text not null,
  details text,
  published boolean not null default false,
  resource_import_id bigint references resource_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, directory_name, hsds_id),
  unique (id, newsroom_id),
  check (service_id is not null or location_id is not null),
  foreign key (service_id, newsroom_id) references services (id, newsroom_id)
    on delete cascade,
  foreign key (location_id, newsroom_id) references locations (id, newsroom_id)
    on delete cascade
);

create index if not exists accessibilities_newsroom_idx
  on accessibilities (newsroom_id);
create index if not exists accessibilities_service_idx
  on accessibilities (service_id, newsroom_id);
create index if not exists accessibilities_location_idx
  on accessibilities (location_id, newsroom_id);

-- The review lane. A change never writes a published field by itself: it lands
-- here as a pending proposal, and an editor accepts or rejects it (Phase 2).
-- evidence_capture_id is NOT NULL on purpose (13.3): a change with no retained
-- capture cannot be stored at all.
create table if not exists resource_changes (
  id bigserial primary key,
  newsroom_id integer not null,
  scan_run_id integer references scan_runs(id) on delete set null,
  source_id integer references sources(id) on delete set null,
  source_capture_id integer references snapshots(id) on delete set null,
  evidence_capture_id integer not null references snapshots(id) on delete cascade,
  evidence_tier text not null check (evidence_tier in ('A', 'B', 'C')),
  entity_type text not null
    check (entity_type in (
      'organization', 'service', 'location', 'service_at_location', 'schedule',
      'contact', 'eligibility', 'required_document', 'language',
      'accessibility', 'taxonomy'
    )),
  entity_id integer,
  field_name text not null,
  before_value text,
  after_value text,
  change_kind text not null
    check (change_kind in (
      'field_change', 'eligibility_change', 'hours_change', 'closure', 'move',
      'contact_change', 'funding_change', 'non_informational'
    )),
  summary text,
  model_confidence numeric,
  review_state text not null default 'pending'
    check (review_state in ('pending', 'accepted', 'rejected', 'needs-editor')),
  reviewed_by text,
  reviewed_at timestamptz,
  lead_id integer references leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resource_changes_newsroom_idx
  on resource_changes (newsroom_id);
create index if not exists resource_changes_review_idx
  on resource_changes (newsroom_id, review_state);

-- Anonymous usage counts only (13.2): no IP, no user agent, no session id,
-- and no retained free text.
create table if not exists resource_queries (
  id bigserial primary key,
  newsroom_id integer not null,
  created_at timestamptz not null default now(),
  intent_category text,
  matched_service_ids integer[] not null default '{}'::integer[],
  unmatched boolean not null default false
);

create index if not exists resource_queries_newsroom_idx
  on resource_queries (newsroom_id);

comment on table resource_imports is
  'One row per HSDS directory import: which directory, in what format, how many rows, what conflicts.';
comment on table resource_changes is
  'The review lane. Every proposed registry change carries the capture it rests on; nothing here is published by itself.';
comment on table resource_queries is
  'Anonymous query counts only. No IP, user agent, session id, or free text.';
