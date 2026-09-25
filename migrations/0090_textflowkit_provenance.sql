-- Speech-to-text provenance (unit R, 0.6.63).
--
-- A meeting with no captions can now be transcribed from its retained audio by
-- textflowkit. That transcript is stored through the same artifact table the
-- captions use, and this column is what keeps the two distinguishable after the
-- fact: which tool, which version, which model, which device, and the SHA-256 of
-- the audio those words were heard in.
--
-- Nullable on purpose. Every caption artifact predating this migration has no
-- provenance, and "no provenance recorded" is the honest reading of those rows;
-- a default would assert something the paper cannot support.
alter table meeting_transcript_artifacts
  add column if not exists provenance_json text;

comment on column meeting_transcript_artifacts.provenance_json is
  'JSON provenance for a transcript revision. For source_method=textflowkit-json: tool, toolVersion, model, device, language, audioArtifactId, audioSha256, wordCount, argv.';
