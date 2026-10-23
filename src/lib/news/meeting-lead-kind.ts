/**
 * The one definition of "this lead is a meeting story".
 *
 * Three places ask the question and must answer it the same way: which writer
 * gets the draft, whether the Publish warning says "The meeting writer", and
 * whether the notes side pane prints the meeting heading. A lead is a meeting
 * story when it names a meeting video AND its purpose is `transcript-story`.
 *
 * A lead can carry a meeting video for other purposes (a follow-up, a clip),
 * so the video id alone is not enough. Pure: no database, no server imports.
 */
export function isMeetingStoryLead(lead: {
  meeting_video_id?: unknown;
  meeting_lead_purpose?: unknown;
}): boolean {
  return Boolean(lead.meeting_video_id) && lead.meeting_lead_purpose === "transcript-story";
}
