/**
 * What to say when a Pull ends with nothing.
 *
 * The live defect: three Pulls on Story lead 406 all ended "Finished · no
 * relevant public document found" while every search provider had actually
 * refused to answer -- "13 provider or page failures" behind the fold, and a
 * sentence that reads to an editor as "the topic has nothing". Those are two
 * different facts and the run box said the wrong one.
 *
 * So the ending is computed from what the providers really did:
 *
 *  - no provider answered and at least one refused -> search is unavailable,
 *    named provider by provider, and retrying right now will probably repeat it;
 *  - some provider answered and nothing relevant came back -> the searches ran
 *    and found nothing, with any refusal mentioned in passing;
 *  - nothing refused and nothing found -> the sentence that was already there.
 *
 * The raw `SEARCH_FAILED_PROVIDER` strings stay on the receipt for support. The
 * editor gets these words instead.
 */

export type ProviderFailure = { provider: string; state: string; error?: string };

export type ProviderFailureNote = { provider: string; label: string; reason: string };

/**
 * Provider ids as the editor knows them.
 *
 * The pipeline sees whatever the provider calls itself -- `exa-mcp`,
 * `ddg-html`, `DuckDuckGo` -- and none of those is a thing to print on a desk.
 */
const PROVIDER_LABELS: Record<string, string> = {
  "exa-mcp": "Exa",
  exa: "Exa",
  "ddg-html": "DuckDuckGo",
  "ddg-lite": "DuckDuckGo Lite",
  duckduckgo: "DuckDuckGo",
  "duckduckgo lite": "DuckDuckGo Lite",
  bing: "Bing",
  brave: "Brave",
  wikipedia: "Wikipedia",
  "halo-gateway": "the search gateway",
  "search gateway": "the search gateway",
};

export function providerLabel(provider: string): string {
  const raw = String(provider ?? "").trim();
  if (!raw) return "a search provider";
  return PROVIDER_LABELS[raw.toLowerCase()] ?? raw;
}

/**
 * Why a provider failed, in the editor's words.
 *
 * A 429 is the provider rate-limiting this computer; a block with no 429 is
 * DuckDuckGo refusing scripted requests; a timeout or a network failure is a
 * provider that did not answer; a parse failure is one that answered in a form
 * the desk could not read. They are different facts and the editor is owed the
 * difference.
 */
export function providerFailureReason(state: string, error?: string): string {
  const text = String(error ?? "").toLowerCase();
  const rateLimited = /\b429\b|rate.?limit/.test(text);
  switch (state) {
    case "SEARCH_BLOCKED":
      return rateLimited ? "rate limited" : "blocked this computer";
    case "SEARCH_TIMEOUT":
    case "SEARCH_FAILED_NETWORK":
      return "did not answer";
    case "SEARCH_FAILED_PARSE":
      return "answered in a form we could not read";
    case "SEARCH_FAILED_PROVIDER":
      return rateLimited ? "rate limited" : "refused to answer";
    default:
      return rateLimited ? "rate limited" : "did not answer";
  }
}

export function providerFailureNote(failure: ProviderFailure): ProviderFailureNote {
  return {
    provider: failure.provider,
    label: providerLabel(failure.provider),
    reason: providerFailureReason(failure.state, failure.error),
  };
}

/** One provider named once, however many queries it failed on. */
export function providerFailureNotes(failures: ProviderFailure[]): ProviderFailureNote[] {
  const out: ProviderFailureNote[] = [];
  for (const failure of failures ?? []) {
    const note = providerFailureNote(failure);
    if (!out.some((row) => row.label === note.label && row.reason === note.reason)) out.push(note);
  }
  return out;
}

/** "Exa: rate limited; DuckDuckGo: blocked this computer" */
export function failureSummary(notes: ProviderFailureNote[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const note of notes ?? []) {
    const text = `${note.label}: ${note.reason}`;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.join("; ");
}

/**
 * The closing sentence of a Pull that found nothing.
 *
 * `answered` is true when at least one provider really returned a result list,
 * empty or not. That is the difference between "we searched and the record is
 * not there" and "we could not search".
 */
export function finalPullText(input: {
  documents: number;
  failures: ProviderFailureNote[];
  answered: boolean;
}): string {
  if (input.documents > 0) {
    return `Finished · ${input.documents} relevant document${input.documents === 1 ? "" : "s"} saved`;
  }
  const failed = failureSummary(input.failures ?? []);
  if (failed && !input.answered) {
    return `Failed · search is unavailable — ${failed}. Trying again right now will probably repeat it.`;
  }
  if (failed) {
    return `Failed · some searches could not be completed: ${failed}.`;
  }
  return "Finished · no relevant public document found";
}

/**
 * The mark left on the Still-to-pull line.
 *
 * Plain words and nothing counted: the row is what an editor reads, and "N
 * provider or page failures" told them nothing about whether to press Pull
 * again. The route prints the time it was tried in front of this.
 */
export function pullTodoReason(input: {
  status: string;
  failures: ProviderFailureNote[];
  answered: boolean;
  failureReason?: string;
}): string {
  if (input.status === "deadline") return "the two-minute limit was reached before a document was found";
  if (input.status === "stopped") return "stopped before a document was found";
  const failed = failureSummary(input.failures ?? []);
  if (input.status === "failed") {
    if (input.failureReason) return input.failureReason;
    if (failed && !input.answered) return `search unavailable (${failed})`;
    if (failed) return `some searches could not be completed (${failed})`;
    return "Pull failed; open the story to check why";
  }
  if (failed && !input.answered) return `search unavailable (${failed})`;
  if (failed) return `some searches failed (${failed})`;
  return "no relevant document found";
}

/**
 * Are these words a Pull's own "it found nothing" line?
 *
 * PULL1b finding 3: when a later Pull succeeds it clears the reason it is
 * striking, so a restored line starts clean. Clearing has to recognise what to
 * clear -- a to-do row's `q` is also where the claims-of-absence gate writes
 * its "searched <domain> and 3 more ways" summary and where `request-input`
 * carries a drafting detail line, and neither of those may be wiped.
 *
 * The two tests are the shapes `pullTodoReason` can print, and the row's own
 * `triedAt` stamp (which only a Pull writes). A row from a build before the
 * stamp existed still has one of these five shapes, so shape alone is enough;
 * everything else is left alone.
 */
export function isPullTodoReason(text: string): boolean {
  const s = String(text ?? "").trim();
  if (!s) return false;
  return (
    s === "no relevant document found" ||
    s.startsWith("no relevant document found; some searches failed (") ||
    s.startsWith("search unavailable (") ||
    s.startsWith("some searches could not be completed (") ||
    s.startsWith("Could not open ") ||
    s.startsWith("Could not save the Pull result ") ||
    s.startsWith("The desk could not confirm that the Pull result was saved.") ||
    s.startsWith("Pull failed;") ||
    s === "the two-minute limit was reached before a document was found" ||
    s === "stopped before a document was found"
  );
}
