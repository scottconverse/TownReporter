export type SourceRow = {
  id: number;
  url: string;
  title: string;
  kind: string;
  tier: string;
  status: string;
  last_hash: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
};

export type LeadRow = {
  id: number;
  scan_run_id?: number | null;
  headline: string;
  why: string;
  topic: string;
  /** The scan filed this lead under a section the model never named, so the
   * section shown is the desk's fallback rather than a decision. Set by
   * `parseScanResult` (lib/news/schema.ts), cleared when an editor confirms a
   * section on the draft (`performConfirmDraftTopic`, lib/news/desk.ts). */
  topic_unchosen?: boolean;
  status: string;
  source_urls: string;
  evidence: string | null;
  newsworthiness: number | null;
  created_at: string;
  /** How this lead entered the desk (migration 0091). "import" = read out of
   * a report the editor pasted; null = not recorded, which includes every lead
   * filed before 0091 and every scanner lead (those carry scan_run_id). */
  origin?: string | null;
  article_slug?: string | null;
  investigation_id?: number | null;
  notes_json?: string | null;
  resurfaced_count?: number;
  last_resurfaced_at?: string | null;
  last_resurfaced_scan_run_id?: number | null;
  /** QA-1 round 3: set when this lead was filed as a "possible" (not
   * "strong") match against an existing lead -- see matchStrength in
   * lib/news/lead-match.ts. Points at that existing lead's id; null for a
   * plain new lead or a strong match (which never gets its own new row). */
  possible_duplicate_of?: number | null;
  /** The prior lead is returned only when it still belongs to this newsroom.
   * A removed target is deliberately null rather than leaking historical text. */
  possible_duplicate?: { id: number; headline: string; status: string } | null;
  meeting_video_id?: string | null;
  meeting_artifact_id?: number | null;
  meeting_lead_purpose?: string | null;
};

export type DraftRow = {
  id: number;
  lead_id: number;
  headline: string;
  dek: string;
  body: string;
  topic: string;
  source_urls: string;
  integrity_notes: string | null;
  updated_at: string;
  provenance_json?: string | null;
  form?: string | null;
  found_note?: string | null;
  unanswered?: string | null;
  research_json?: string | null;
  /** Migration 0091. The reader-facing line the import review screen chose.
   * Empty = the publish path falls back to the standard line. */
  disclosure_text?: string | null;
  /** Migration 0093. The headline the model wrote, kept even when `headline`
   * holds the editor's. Null/absent = written before 0.6.67, not recorded. */
  model_headline?: string | null;
  /** Migration 0093. The section the model chose, kept alongside `topic`
   * (which is what prints and may be the editor's). */
  model_topic?: string | null;
  /** Migration 0093. Who last decided this row's headline: `model` or
   * `editor`. A redraft keeps the editor's headline when this reads editor. */
  headline_source?: string | null;
};

export type ArticleRow = {
  id: number;
  slug: string;
  headline: string;
  dek: string;
  body: string;
  topic: string;
  source_urls: string;
  status: string;
  published_at: string;
  provenance_json?: string | null;
  form?: string | null;
  found_note?: string | null;
  unanswered?: string | null;
  /** Migration 0091. The disclosure line this article prints. Empty = the
   * standard line from src/components/ai-disclosure.tsx. */
  disclosure_text?: string | null;
  provenance?: import("./findings").ProvenanceItem[];
  findings?: import("./findings").StoryFinding[];
  corrections?: { date: string; body: string }[];
};

export type MemoryRow = {
  id: number;
  entity: string;
  last_angle: string;
  updated_at: string;
};

export type ScanRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  sources_fetched: number;
  leads_created: number;
  sources_proposed: number;
  /**
   * Coverage accounting (migration 0065). Every run records the full path from
   * selection to filing so a zero-lead success, a provider failure, and a
   * partially-analyzed run are distinguishable in the UI. Absent on rows
   * written before this migration -- read them with `?? 0`, never assume.
   */
  sources_selected?: number;
  sources_attempted?: number;
  sources_failed?: number;
  sources_analyzed?: number;
  model_batches_used?: number;
  model_batches_failed?: number;
  failed_sources?: string | null;
  meetings_found?: number;
  meetings_captured?: number;
  meetings_failed?: number;
  meeting_failures?: string | null;
  summary: string | null;
  error: string | null;
  execution_origin?: "manual" | "scheduled";
  /**
   * Set only on the most recent row by `listScans` -- true when the run
   * looks open (no finished_at, no error) but the desk_jobs heartbeat behind
   * it has gone cold or never existed. See `runLooksStalled` in `./jobs`.
   */
  stalled?: boolean;
};

export type CorrectionRow = {
  id: number;
  body: string;
  created_at: string;
  headline: string | null;
  slug?: string | null;
};

/**
 * The Follow-ups object (Direction A, stage 1): who the editor asked and
 * what they owe. One row per ask; `lead_id`/`article_id` link it to the
 * story it belongs to when known. See migrations/0042_follow_ups.sql.
 */
export type FollowUpRow = {
  id: number;
  lead_id: number | null;
  article_id: number | null;
  who: string;
  what: string;
  due_on: string | null;
  status: "open" | "answered" | "dropped";
  nudged_at: string | null;
  answered_at: string | null;
  reply_text: string | null;
  created_at: string;
  lead_headline?: string | null;
  article_slug?: string | null;
  article_headline?: string | null;
};
