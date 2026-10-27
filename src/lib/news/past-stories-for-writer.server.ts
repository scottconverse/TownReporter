import { embedTexts } from "./evidence-embed.server.ts";
import { formatShortDate } from "../paper.ts";
import { pastStoryCoverage, searchPastStories } from "./story-meaning-search.server.ts";
import { PAST_STORIES_LIMIT, type PastStoryBackground } from "./past-stories-block.ts";

/**
 * Finds the paper's own past stories closest in meaning to the story about to
 * be written, for `draftInput.pastStories` (DEF-1, part C). It warns and never
 * blocks: any failure -- the meaning model will not load, the table is not
 * there yet, nothing is indexed -- gives an empty list and the draft goes on
 * exactly as it did before this existed.
 *
 * The model is never waited on for long. A draft is a long job the editor is
 * watching; the first time the model loads on a machine it may need seconds
 * (or a download), so this gives it `timeoutMs` and moves on without. The load
 * keeps going in the background, so the next draft has it.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
const QUERY_MAX_CHARS = 600;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the meaning model was too slow")), ms);
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function pastStoriesForWriter(
  input: {
    newsroomId: number;
    leadId: number;
    headline: string;
    why?: string | null;
    assignment?: string | null;
  },
  options: { timeoutMs?: number } = {},
): Promise<PastStoryBackground[]> {
  try {
    if (process.env.TOWNREPORTER_MEANING_SEARCH === "off") return [];
    const query = [input.headline, input.why, input.assignment]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(". ")
      .slice(0, QUERY_MAX_CHARS);
    if (!query) return [];
    const work = (async () => {
      // Nothing indexed yet: do not wake the model for an empty answer.
      if ((await pastStoryCoverage(input.newsroomId)).covered === 0) return [];
      const [vector] = await embedTexts([query]);
      if (!vector) return [];
      return searchPastStories(input.newsroomId, vector, {
        limit: PAST_STORIES_LIMIT,
        excludeLeadId: input.leadId,
      });
    })();
    // A rejection after the timeout has already won the race must not surface
    // as an unhandled rejection.
    work.catch(() => undefined);
    const rows = await withTimeout(work, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return rows.map((row) => ({
      headline: row.headline,
      date: formatShortDate(row.publishedAt),
      url: row.url,
    }));
  } catch {
    return [];
  }
}
