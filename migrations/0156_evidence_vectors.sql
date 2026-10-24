-- D285/D286 (Scott Oct 24 2026). Evidence search by meaning on the Story page.
-- One row per distinct excerpt: md5(excerpt) -> a 384-number MiniLM vector.
-- Deliberately NOT the excerpt and NOT the url: the vector store can then never
-- become a second copy of captured text that a takedown or a legal removal
-- would have to chase. Every search joins the md5 back to a live, non-blank
-- `artifact_chunks` row, so a removed passage drops out on its own.
-- The vector is 384 float32 numbers, little-endian, stored as bytes.
-- Additive only; nothing is deleted.

create table if not exists evidence_vectors (
  excerpt_md5 text primary key,
  model text not null,
  dims integer not null,
  vector bytea not null,
  created_at timestamptz not null default now()
);

comment on table evidence_vectors is
  'Evidence search by meaning (D286): md5(artifact_chunks.excerpt) -> normalized 384-dim MiniLM vector, little-endian float32. No text and no url are stored here; the background fill writes rows and the prune removes those no live excerpt can match.';
