import type { ReportingNotes } from "./notes.ts";

/**
 * Turns a captured meeting into the drafting input the desk already understands.
 *
 * The desk drafts supplied material through `notes.suppliedUrls` (which documents
 * to read) and `notes.scratch` (the evidence block the writer is given). A meeting
 * transcript is supplied material of exactly that kind, so this assembles it into
 * those two fields rather than inventing a channel. That is what keeps the model
 * ladder, refusal handling, budgets and evidence receipts identical to every other
 * draft.
 *
 * Two rules the assembly must not break:
 *
 * 1. Votes are stated as the structured record states them. Nothing here reads a
 *    tally out of prose. A vote the record does not establish is reported as not
 *    established.
 * 2. Every excerpt carries its item, its timestamp and its index, so the draft step
 *    can record which positions the prose drew from and the revision re-check has
 *    something to compare. An excerpt without its position is unciteable.
 */
export type MeetingDraftMaterial = {
  title: string;
  meetingDate: string | null;
  videoUrl: string;
  items: { item: string; title: string; startSeconds: number; excerpt: string }[];
  votes: {
    item: string;
    established: boolean;
    motion: string | null;
    mover: string | null;
    seconder: string | null;
    tally: string | null;
    result: string | null;
    source: string;
  }[];
};

/** Seconds to `hh:mm:ss`, the form the editor reads. */
export function meetingClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * The evidence block. This is what the writer is given, and it is deliberately
 * shaped so the writer cannot mistake a summary for the record: every excerpt is
 * labelled with the item and timestamp it came from, and the vote section names
 * its source.
 */
export function meetingEvidenceBlock(material: MeetingDraftMaterial): string {
  const out: string[] = [];
  out.push(`MEETING: ${material.title}${material.meetingDate ? ` (${material.meetingDate})` : ""}`);
  out.push(`RECORDING: ${material.videoUrl}`);
  out.push("");
  out.push("The following is the captured transcript, excerpted by agenda item. Every line is");
  out.push("verbatim from the recording and carries the timestamp it was spoken at. Treat it as");
  out.push("the record of what was said. It is auto-captioned, so names and numbers can be");
  out.push("mangled: if an excerpt is unclear, say so rather than guessing.");
  out.push("");
  for (const item of material.items) {
    out.push(`--- ITEM ${item.item}${item.title ? `: ${item.title}` : ""} (from ${meetingClock(item.startSeconds)}) ---`);
    out.push(item.excerpt.trim());
    out.push("");
  }
  out.push("--- VOTES, FROM THE STRUCTURED RECORD ---");
  const established = material.votes.filter((v) => v.established);
  if (!established.length) {
    /*
      Saying this plainly is the point. An empty list and "no vote established"
      look identical to a writer, and a writer that cannot tell them apart is how
      a tally gets invented.
    */
    out.push("No vote was established from the structured record for any item in this meeting.");
    out.push("Do not state a vote, a tally, or a result. If the transcript appears to describe one,");
    out.push("say the record does not establish it rather than reporting it as fact.");
  } else {
    for (const v of established) {
      const bits = [
        `Item ${v.item}`,
        v.motion ? `motion: ${v.motion}` : "",
        v.mover ? `moved by ${v.mover}` : "",
        v.seconder ? `seconded by ${v.seconder}` : "",
        v.tally ? `tally ${v.tally}` : "",
        v.result ? `result: ${v.result}` : "",
        `source: ${v.source}`,
      ].filter(Boolean);
      out.push(`- ${bits.join("; ")}`);
    }
  }
  return out.join("\n");
}

/**
 * The notes the draft step reads. `suppliedUrls` is the only public record the
 * draft may fetch, and the scratch block is the transcript evidence. The scope is
 * `supplied`, so the writer treats this material as the assignment rather than
 * going looking for a different story.
 */
export function meetingDraftNotes(
  material: MeetingDraftMaterial,
  base: ReportingNotes,
): ReportingNotes {
  return {
    ...base,
    researchScope: "supplied",
    suppliedUrls: material.videoUrl ? [material.videoUrl] : [],
    scratch: meetingEvidenceBlock(material),
  };
}

