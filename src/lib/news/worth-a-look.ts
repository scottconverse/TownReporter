import {
  editorKindLabel,
  extractUrl,
  headlineFromUrl,
  looksLikeUrl,
  organizationFromUrl,
  sourceLineFromUrl,
  titlesOverlap,
  withoutUrls,
  worthTitle,
} from "./desk-copy.ts";

export type WorthSeed = {
  id: string;
  kind: string;
  title: string;
  happened: string;
  why: string;
  evidence: string;
  source_url: string;
  question: string;
  seed: string;
  priority: number;
  badge?: string;
  source_line?: string;
};

type AnomalyIn = { kind: string; summary: string; url: string | null; details: string | null; created_at?: string };
type MonitorIn = { url: string; title: string; last_outcome: string | null };
type LeadIn = { id: number; headline: string; why: string; evidence: string | null; newsworthiness: number | null; source_urls: string };
type FrontierIn = { label: string; kind: string; why: string; status: string; closed_reason: string | null };
type SignalIn = { id: number; name: string; observation: string; pathway: string; handoff: string; strength: number };
type PromiseIn = { who_promised: string; what: string; when_due: string | null; source_cite: string | null; status: string };

/** Ranking bonuses only. Unknown kinds stay eligible. */
const PRIORITY_BONUS: Record<string, number> = {
  disappeared: 12,
  removed: 12,
  "soft-404": 12,
  "missing-cadence": 10,
  "missing-record": 10,
  reopened: 11,
  company: 8,
  contract: 8,
  rfp: 8,
  legislation: 8,
  url: 7,
  "unresolved-reference": 7,
  "unresolved-provenance": 7,
  /*
    A resident's tip, not a record.

    Ranked below every anomaly the desk found in a document, and deliberately
    so: it is the only kind here that nobody has verified. High enough to be
    seen on a quiet day, low enough that it never outranks a missing minute.
  */
  "reddit-tip": 6,
};

function frontierPriority(status: string, kind: string): number {
  if (status === "reopened") return PRIORITY_BONUS.reopened ?? 11;
  return PRIORITY_BONUS[kind] ?? 6;
}

function questionFor(kind: string, title: string): string {
  const t = title.slice(0, 80);
  switch (kind) {
    case "disappeared":
    case "removed":
    case "soft-404":
      return `Was ${t} taken down, moved, or replaced?`;
    case "changed":
      return `What specifically changed, and does the new version drop anything the old one had?`;
    case "missing-cadence":
    case "missing-record":
      return `Was the expected document delayed, renamed, cancelled, or never posted?`;
    case "reopened":
      return `What new evidence revived this, and what did we miss the first time?`;
    case "lead":
      return `What does the announcing source leave unexplained?`;
    case "signal":
      return `What independent record would confirm or kill this?`;
    case "promise":
      return `Did this promise return on a later agenda, or was it quietly dropped?`;
    case "reddit-tip":
      return `Which agency would hold the record for this, and does that record say the same thing?`;
    default:
      return `What public record would confirm or contradict this?`;
  }
}

export function rankWorthItems(input: {
  anomalies?: AnomalyIn[];
  monitors?: MonitorIn[];
  leads?: LeadIn[];
  frontier?: FrontierIn[];
  signals?: SignalIn[];
  promises?: PromiseIn[];
}): WorthSeed[] {
  const out: WorthSeed[] = [];

  for (const a of input.anomalies ?? []) {
    const kind = a.kind || "anomaly";
    const title = a.summary.slice(0, 160) || kind;
    const url = a.url ?? "";
    out.push({
      id: `anomaly:${kind}:${url || title}`,
      kind,
      title,
      happened: a.details?.trim() || a.summary,
      /*
        A tip needs its own words.

        The generic line — "a monitored public record did not look the way it
        usually does" — is not merely vague on a Reddit card, it is false: no
        record was monitored and nothing changed. Somebody posted something.
      */
      why:
        kind === "reddit-tip"
          ? "A resident posted this on the town's subreddit. Nobody has checked it."
          : `Dark Desk / monitors flagged a ${kind.replace(/-/g, " ")}.`,
      evidence: url || a.summary,
      source_url: url,
      question: questionFor(kind, title),
      seed: [a.summary, a.details, url].filter(Boolean).join("\n").slice(0, 4000),
      priority: PRIORITY_BONUS[kind] ?? 9,
    });
  }

  for (const m of input.monitors ?? []) {
    const gone = /removed|not-found|soft-404|disappeared/i.test(m.last_outcome ?? "");
    const changed = /changed/i.test(m.last_outcome ?? "");
    if (!gone && !changed) continue;
    const kind = gone ? "disappeared" : "changed";
    out.push({
      id: `monitor:${m.url}`,
      kind,
      title: gone
        ? `Monitored record disappeared: ${m.title || m.url}`
        : `Monitored record changed: ${m.title || m.url}`,
      happened: `${m.title || m.url} last outcome ${m.last_outcome}.`,
      why: "A source TownReporter is watching did not look the same on the last autonomous check.",
      evidence: m.url,
      source_url: m.url,
      question: questionFor(kind, m.title || m.url),
      seed: `${m.title}\n${m.url}\nMonitor outcome: ${m.last_outcome}`,
      priority: gone ? 13 : 10,
    });
  }

  for (const f of input.frontier ?? []) {
    if (f.status !== "reopened" && f.status !== "open") continue;
    out.push({
      id: `frontier:${f.kind}:${f.label}`,
      kind: f.status === "reopened" ? "reopened" : f.kind,
      title: f.label.slice(0, 160),
      happened: f.why,
      why:
        f.status === "reopened"
          ? `Previously parked (${f.closed_reason || "exhausted"}). New evidence put it back on the desk.`
          : f.why,
      evidence: f.label,
      source_url: /^https?:/i.test(f.label) ? f.label : "",
      question: questionFor(f.status === "reopened" ? "reopened" : f.kind, f.label),
      seed: `${f.label}\n${f.why}\n${f.closed_reason ?? ""}`,
      priority: frontierPriority(f.status, f.kind),
    });
  }

  for (const s of input.signals ?? []) {
    if (!/CONTINUE|FOR VERIFICATION|FINDING|MONITOR/i.test(s.handoff)) continue;
    out.push({
      id: `signal:${s.id}`,
      kind: "signal",
      title: s.name.slice(0, 160),
      happened: s.observation.slice(0, 400),
      why: `Prior Dark Desk signal (${s.handoff}, strength ${s.strength}).`,
      evidence: s.pathway.slice(0, 400) || s.observation.slice(0, 400),
      source_url: "",
      question: questionFor("signal", s.name),
      seed: `${s.name}\n${s.observation}\n${s.pathway}`.slice(0, 4000),
      priority: 7 + Math.min(4, s.strength),
    });
  }

  for (const p of input.promises ?? []) {
    if (!/open|unclear/i.test(p.status)) continue;
    const title = `${p.who_promised}: ${p.what}`.slice(0, 160);
    out.push({
      id: `promise:${p.who_promised}:${p.what.slice(0, 40)}`,
      kind: "promise",
      title,
      happened: p.when_due ? `Promised; due ${p.when_due}.` : "A public promise is still open on the ledger.",
      why: "A prior meeting produced a commitment that has not clearly returned.",
      evidence: p.source_cite || p.what,
      source_url: "",
      question: questionFor("promise", p.what),
      seed: `${p.who_promised}\n${p.what}\n${p.when_due ?? ""}\n${p.source_cite ?? ""}`,
      priority: 8,
    });
  }

  for (const l of input.leads ?? []) {
    const nw = l.newsworthiness ?? 0;
    if (nw < 8 && !(l.why || "").toLowerCase().includes("dark")) continue;
    let urls: string[] = [];
    try {
      const parsed = JSON.parse(l.source_urls) as unknown;
      urls = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      urls = [];
    }
    out.push({
      id: `lead:${l.id}`,
      kind: "lead",
      title: l.headline.slice(0, 160),
      happened: l.why.slice(0, 400),
      why: nw >= 8 ? `High-newsworthiness scanner lead (${nw}/20).` : "Lead already on the working queue.",
      evidence: l.evidence || urls[0] || l.why,
      source_url: urls[0] ?? "",
      question: questionFor("lead", l.headline),
      seed: `${l.headline}\n${l.why}\n${l.evidence ?? ""}\n${urls.join("\n")}`.slice(0, 4000),
      priority: Math.min(12, 6 + Math.round(nw / 4)),
    });
  }

  const seen = new Set<string>();
  const ranked = out
    .sort((a, b) => b.priority - a.priority)
    .filter((item) => {
      const key = item.source_url || item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return withReservedTipSlots(ranked, 12, TIP_SLOTS);
}

/** How many of the twelve are held open for unverified tips. */
const TIP_SLOTS = 2;

/**
 * Keep a couple of places for tips that would otherwise never be seen.
 *
 * A resident's tip is ranked below every anomaly found in a document, which is
 * correct — nobody has verified it. But the list is capped at twelve, and on a
 * busy desk twelve records outrank every tip, so the first run of the subreddit
 * reader filed seven tips and displayed none of them. The button said "Filed 7
 * tips" and the page showed nothing: the same silent nothing as not running at
 * all.
 *
 * Reserved, not promoted. A tip still never outranks a missing minute; it just
 * cannot be crowded into invisibility. When there are no tips the reserve costs
 * nothing and the full twelve are records.
 */
export function withReservedTipSlots(
  ranked: WorthSeed[],
  limit: number,
  reserved: number,
): WorthSeed[] {
  const tips = ranked.filter((i) => i.kind === "reddit-tip");
  if (!tips.length) return ranked.slice(0, limit);

  const rest = ranked.filter((i) => i.kind !== "reddit-tip");
  const keptTips = tips.slice(0, Math.min(reserved, limit));
  const kept = rest.slice(0, Math.max(0, limit - keptTips.length));
  // Back into priority order, so the page still reads worst-first.
  return [...kept, ...keptTips].sort((a, b) => b.priority - a.priority);
}

/**
 * `frontier_items.why` is a bookkeeping breadcrumb `investigate.ts` writes for
 * itself (`persistDiscovery` calls such as `Attachment/document link on
 * ${url}` and the literal `Discovered this hop — fetch next`) — never
 * editorial copy. The old cleanup ran `withoutUrls()` first and only then
 * replaced "Attachment/document link on" with "linked from", which threw the
 * URL away before the phrase that named it, leaving "linked from" — a label
 * with its object cut off — as the whole sentence. `Discovered this hop —
 * fetch next` had no rewrite here at all (only the unrelated `plainEditorText`
 * in desk-copy.ts caught it, and that function is never called on this path).
 * An outside audit caught both landing verbatim as card headlines and summary
 * lines, with duplicates, because nothing stood between the breadcrumb and
 * the screen (UX-003).
 *
 * Recognise the breadcrumb shapes by pattern and rewrite them to full
 * sentences BEFORE any URL stripping, so the source is described instead of
 * discarded.
 */
function rewriteFrontierBreadcrumb(why: string): string {
  const attachedFrom = why.match(/^Attachment\/document link on (https?:\/\/\S+)/i);
  if (attachedFrom) {
    const host = organizationFromUrl(attachedFrom[1]);
    return host
      ? `Linked from a document ${host} published.`
      : "Linked from a document Dark Desk already had open.";
  }
  if (/^Discovered this hop/i.test(why)) {
    return "Turned up while following an earlier record. Dark Desk has not opened it yet.";
  }
  const deferred = why.match(/^Fetch (.+?) — deferred, not closed/i);
  if (deferred) {
    return "Dark Desk tried to open this and could not yet — it is still on the list.";
  }
  if (/^Scanned or image-only document/i.test(why)) {
    return "A scanned or image-only document Dark Desk could not fully read yet.";
  }
  return why;
}

/**
 * The last line of defence. Even after `rewriteFrontierBreadcrumb`, nothing
 * guarantees some other caller of `rankWorthItems` never hands it a raw
 * breadcrumb or an empty string — so before a headline or summary line ships,
 * check it isn't one of the exact fragments the audit found on screen (or
 * blank) and swap in a sentence that is honest about not knowing more.
 */
const TEMPLATE_LEAK = /^(linked from|discovered this hop\b.*|attachment\/document link on\b.*)$/i;

function isTemplateLeak(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || TEMPLATE_LEAK.test(t);
}

function stripInternalJargon(text: string): string {
  return withoutUrls(rewriteFrontierBreadcrumb(text))
    .replace(/Previously parked\s*\([^)]*\)\.?\s*/gi, "")
    .replace(/Reopened from resolved:?\s*/gi, "")
    .replace(/Prior:\s*Fetched\.?/gi, "")
    .replace(/\bfrontier\b/gi, "lead")
    .replace(/\b(reopened_from|prior_status|closed_reason)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function reviewingContext(item: WorthSeed, org: string): string {
  const url = extractUrl(`${item.happened} ${item.why} ${item.evidence}`) || item.source_url;
  const from = url ? organizationFromUrl(url) : "";
  if (from) return `a ${from} page`;
  if (org) return `a ${org} record`;
  return "another public record";
}

/** Editor presentation. Ranking and seeds stay as the engine produced them. */
export function presentWorthItem(item: WorthSeed): WorthSeed {
  const url = item.source_url || extractUrl(item.title) || extractUrl(item.evidence);
  let title = item.title;
  if (looksLikeUrl(title) && url) title = headlineFromUrl(url);
  else if (url && title.includes(url)) title = title.replace(url, headlineFromUrl(url)).replace(/\s+/g, " ").trim();
  const org = url ? organizationFromUrl(url) : "";
  const badge = editorKindLabel(item.kind);
  let happened = stripInternalJargon(item.happened);
  let why = stripInternalJargon(item.why);
  if (item.kind === "reopened") {
    happened = `Dark Desk encountered this again while reviewing ${reviewingContext(item, org)}.`;
    why =
      org
        ? `A ${org} record Dark Desk previously considered finished has appeared again in new material. That may mean it is newly relevant to another record or investigation.`
        : "A record Dark Desk previously considered finished has appeared again in new material. That may mean it is newly relevant to another record or investigation.";
  } else if (item.kind === "reddit-tip") {
    // Already written for this card; the generic rewrite below would undo it.
    happened = happened || "Posted on the town's subreddit.";
  } else if (!why || /flagged a |strength |handoff/i.test(item.why)) {
    why = why
      .replace(/Dark Desk \/ monitors flagged a [\w\s]+\./i, "A monitored public record did not look the way it usually does.")
      .replace(/Prior Dark Desk signal \([^)]+\)\.?/i, "A previous Dark Desk pass left this open.")
      .replace(/High-newsworthiness scanner lead \([^)]+\)\.?/i, "The scanner ranked this as worth a reporter’s time.");
  }
  if (!happened || looksLikeUrl(happened) || isTemplateLeak(happened)) {
    happened = url
      ? `This turned up while Dark Desk was reviewing ${org || "a public page"}.`
      : "Something on the beat changed enough to put this on the desk.";
  }
  /*
    Last check before `why` becomes a card's summary line. `rewriteFrontierBreadcrumb`
    and the `else if` above cover the shapes this code knows how to happen; this
    catches anything that got through anyway (a new breadcrumb text nobody has
    seen yet, for instance) rather than trusting every upstream path to be
    exhaustive. Same reasoning as the `happened` guard just above.
  */
  if (isTemplateLeak(why)) {
    why = url
      ? `Dark Desk found this while reviewing ${org || "a public page"}; nobody has verified it yet.`
      : "Dark Desk found this while following an earlier record; nobody has verified it yet.";
  }
  return {
    ...item,
    title: worthTitle({ title: title || item.title, happened, why }),
    happened,
    why,
    badge,
    source_line: url ? sourceLineFromUrl(url) : withoutUrls(item.evidence).slice(0, 160),
  };
}

/**
 * `presentWorthItem` per card, then a final duplicate pass over the titles it
 * actually produced.
 *
 * `rankWorthItems` already de-duplicates, but on the key it has at that
 * point — `source_url || title.toLowerCase()` from the *raw* engine title,
 * before `presentWorthItem` rewrites it. Two frontier items with different
 * URLs (an original page and its own PDF attachment, say) can both collapse
 * to the same rewritten headline and summary once presented — that is what
 * the audit saw as "several cards were exact duplicates" (UX-003). Re-check
 * after presentation, on the text the editor will actually read.
 */
export function presentWorthItems(items: WorthSeed[]): WorthSeed[] {
  const presented = items.map(presentWorthItem);
  const kept: WorthSeed[] = [];
  for (const item of presented) {
    if (kept.some((k) => titlesOverlap(k.title, item.title) && k.why === item.why)) continue;
    kept.push(item);
  }
  return kept;
}
