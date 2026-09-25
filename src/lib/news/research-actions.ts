import { parseJsonBlock } from "./ai.ts";

export type ResearchFinding = {
  text: string;
  evidenceUrl?: string;
};

export type ResearchAction =
  | { type: "search"; query: string; reason: string }
  | { type: "read"; url: string; reason: string }
  | { type: "follow"; url: string; fromUrl?: string; reason: string }
  | { type: "finish"; summary: string; findings: ResearchFinding[] };

export type ResearchActionReceipt = {
  decision: number;
  action: ResearchAction;
  outcome: string;
  detail: string;
  links: string[];
};

/**
 * One tolerant reader, the desk's own (0.6.63, Unit Y item 3).
 *
 * This used to be a second, stricter copy of the fence-strip-and-slice trick
 * followed by a bare `JSON.parse` that THREW: a malformed action reply came
 * back as a raw SyntaxError instead of the typed refusal `parseResearchAction`
 * is written to produce, and it never saw the missing-comma repair
 * `parseJsonBlock` grew for the bake-off's DeepSeek replies. `null` here is
 * handled one line below, so routing through the shared parser changed only
 * which failures are survivable.
 */
function jsonValue(text: string): unknown {
  return parseJsonBlock<unknown>(text);
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseResearchAction(text: string): ResearchAction {
  const value = jsonValue(text) as Record<string, unknown>;
  if (!value || typeof value !== "object") throw new Error("responsive action must be a JSON object");
  const type = clean(value.type, 20);
  if (type === "search") {
    const query = clean(value.query, 300);
    if (!query) throw new Error("search action requires query");
    return { type, query, reason: clean(value.reason, 500) };
  }
  if (type === "read" || type === "follow") {
    const url = clean(value.url, 2_000);
    if (!url) throw new Error(`${type} action requires url`);
    return type === "follow"
      ? { type, url, fromUrl: clean(value.fromUrl, 2_000) || undefined, reason: clean(value.reason, 500) }
      : { type, url, reason: clean(value.reason, 500) };
  }
  if (type === "finish") {
    const findings = Array.isArray(value.findings)
      ? value.findings.slice(0, 12).flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          const finding = clean(row.text, 1_500);
          return finding ? [{ text: finding, evidenceUrl: clean(row.evidenceUrl, 2_000) || undefined }] : [];
        })
      : [];
    return { type, summary: clean(value.summary, 2_500), findings };
  }
  throw new Error("responsive action type must be search, read, follow, or finish");
}

export function responsiveActionPrompt(args: {
  investigation: string;
  receiptHistory: ResearchActionReceipt[];
  availableLinks: string[];
  decision: number;
  limit: number;
}): string {
  return [
    `Choose responsive research action ${args.decision} of ${args.limit}.`,
    "Return one JSON object only. Allowed shapes:",
    '{"type":"search","query":"...","reason":"..."}',
    '{"type":"read","url":"...","reason":"..."}',
    '{"type":"follow","url":"...","fromUrl":"...","reason":"..."}',
    '{"type":"finish","summary":"...","findings":[{"text":"...","evidenceUrl":"..."}]}',
    "Search discovers results but does not read them. Read opens one known result. Follow opens one link found in a captured page. Finish when the evidence is sufficient or the remaining action budget cannot improve it. Never treat search snippets as evidence.",
    `AVAILABLE CAPTURED-PAGE LINKS:\n${args.availableLinks.length ? args.availableLinks.join("\n") : "(none)"}`,
    `EXECUTED RECEIPTS:\n${args.receiptHistory.length ? JSON.stringify(args.receiptHistory) : "(none)"}`,
    `INVESTIGATION STATE:\n${args.investigation}`,
  ].join("\n\n");
}
