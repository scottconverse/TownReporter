import { storyReadinessChip, type StoryReadiness } from "../lib/news/story-readiness.ts";

export function StoryReadinessChip({ readiness }: { readiness: StoryReadiness }) {
  const chip = storyReadinessChip(readiness);
  const tone = { ok: "d-ok", warn: "d-warn", quiet: "d-quiet" }[chip.tone];
  return (
    <span
      className={`chip ${tone}`}
      data-story-readiness={readiness.state}
      role="status"
      aria-live="polite"
      title={readiness.reason}
    >
      {chip.text}
    </span>
  );
}
