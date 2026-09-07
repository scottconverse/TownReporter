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
  headline: string;
  why: string;
  topic: string;
  status: string;
  source_urls: string;
  evidence: string | null;
  newsworthiness: number | null;
  created_at: string;
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
