-- Link independently captured document versions to the owning connector evidence.
create table if not exists civic_connector_documents (
  newsroom_id integer not null,
  evidence_id integer not null references civic_connector_evidence(id) on delete cascade,
  version_id integer not null references artifact_versions(id),
  capture_event_id integer not null references capture_events(id),
  primary key (newsroom_id, evidence_id, version_id)
);
