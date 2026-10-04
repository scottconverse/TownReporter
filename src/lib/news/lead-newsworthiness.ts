/**
 * Does a scan candidate describe a NEWS EVENT, or just a page that exists?
 *
 * The scan keeps filing standing web pages as leads -- an obituaries index, a
 * nonprofit's projects index, a cafe's hours page. A page that only describes
 * what exists has no event, and an event is what makes a lead news. This module
 * is the desk's cheap, deterministic half of that judgement; the model half
 * (the `is_event` / `event` / `event_date` fields the scan prompt now asks for,
 * see ./desk-copy.ts) covers the cases no pattern can settle.
 *
 * The rules here come from established practice, not from this desk's kill
 * history (the editor often killed without a reason, so kills are weak
 * evidence at best):
 *
 *   1. News values require an EVENT. Galtung & Ruge (1965) and Harcup &
 *      O'Neill (2017) put "event-ness" at the centre of what is news: something
 *      happened, will happen on a date, was decided, changed, announced or
 *      disputed, or a number moved. A directory, a list of funds, opening
 *      hours, a "lists" page, an obituary index or an about page describes
 *      what exists and has no event. -- R1-R5 below name the page shapes.
 *
 *   2. Page-change monitoring. The Marshall Project's Klaxon (and every page
 *      watcher since) treats a standing page as a WATCH TARGET: the news is the
 *      CHANGE to it -- the new obituary name, the new grant, the new meeting --
 *      never the page itself. If the scan cannot say what changed, it must not
 *      make a lead from that page. -- R4 (an events listing) and the model
 *      gate.
 *
 *   3. Event-detection systems (Reuters Tracer, 2017) score on event-ness,
 *      novelty and local relevance, drop below a threshold, and keep the
 *      decision explainable -- a short reason a person can read. -- the model
 *      gate keeps `is_event` plus the event sentence, and the caller writes a
 *      one-line reason into the scan summary.
 *
 *   4. Evergreen / boilerplate detection: URL and title patterns for standing
 *      pages (/directory, /about, /hours, obituaries index, /projects, /funds,
 *      "Lists", "Index", "Page", "Directory", "Hours"). -- R1-R3.
 *
 *   5. Meeting records. "A meeting is news when something is decided, proposed
 *      or disputed, not when a record is posted" (this desk's rule, after two
 *      routine commission records -- an agenda and a set of minutes -- were
 *      filed as leads). A headline that is nothing but a public body's name and
 *      a date is a record that the meeting was held, not news from it. -- R5.
 *
 * A rule only fires when the candidate shows a page ARTIFACT and no event: a
 * title that carries a dated event ("...Fundraiser Set for Oct. 10") is left
 * for the model even if its source URL is a listing. That is deliberate. The
 * editor's own published set contains leads whose titles read like listings
 * ("Longmont Public Library Lists Regular Hours", lead 314; "Salud's Longmont
 * Clinic Lists Extended Medical Hours", lead 362), so a bare "Lists" or "Hours"
 * token is NOT enough to drop a lead here -- those are the model's call. Only
 * unambiguous page artifacts are dropped by pattern.
 */

/** The event fields the scan prompt asks the model for, on top of the lead. */
export type LeadEventFields = {
  /**
   * The model's own answer to "is this a news event?". Absent means the reply
   * predates this field (or the model said nothing), and an absent answer must
   * never drop a lead -- "the desk did not ask" and "the model said no" are not
   * the same thing. Only an explicit `false` drops.
   */
  is_event?: boolean;
  /** One sentence: what happened, will happen, was decided/changed/announced. */
  event?: string;
  /** The event's date, if the source states one. "" when it does not. */
  event_date?: string;
};

export type StandingPageStamp = {
  /** Short rule id (R1-R5), for tests and logs. */
  rule: string;
  /** One line the editor can read: why this candidate is a page, not news. */
  reason: string;
};

/** Anything with a headline and source URLs: a parsed lead, an AI lead, a row. */
type LeadLike = { headline?: string | null; source_urls?: string[] | null };

/**
 * A date on the title is the strongest cheap signal that a candidate is about
 * an EVENT rather than a page. "Sept. 17", "Oct. 8", "November 3" -- a month
 * word followed by a day number. A bare month ("October Recovery Circles") is
 * not a date: a listing of October events names a month and no event.
 *
 * Exported so the model gate and the prompt docs can cite the same rule.
 */
export const TITLE_EVENT_DATE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*\d{1,2}\b/i;

/** A machine date, if the model wrote one into the headline. */
const TITLE_MACHINE_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

/** True when the title itself carries a dated event. */
export function titleCarriesEventDate(headline: string): boolean {
  return TITLE_EVENT_DATE.test(headline) || TITLE_MACHINE_DATE.test(headline);
}

/** Pathnames of the candidate's source URLs, best-effort ("" for a bad URL). */
export function sourcePaths(urls: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of urls ?? []) {
    try {
      out.push(new URL(raw).pathname);
    } catch {
      out.push("");
    }
  }
  return out;
}

/*
  R1 -- obituaries index (news values + page-change rule).

  "Obituaries Page Lists Recent Death Notices" is a page that exists; the news
  would be one NAME newly added to it. A whole obituary index is never one
  event. Fires on a title that names an obituaries page/index/list of notices,
  or a source URL whose path is the obituaries index itself.
*/
function obituaryIndexStamp(lead: LeadLike): StandingPageStamp | null {
  const title = lead.headline ?? "";
  if (/\bobituar(?:y|ies)\b/i.test(title) && /\b(page|index|directory|list|notices|listing|archive)\b/i.test(title)) {
    return { rule: "R1", reason: "obituaries index page in the title, not one death notice" };
  }
  if (sourcePaths(lead.source_urls).some((p) => /\/obituar(?:y|ies)\/?$/i.test(p))) {
    return { rule: "R1", reason: "source URL is an obituaries index page" };
  }
  return null;
}

/*
  R2 -- directory / index page (evergreen pattern).

  A "Directory" or an "Index" is a page listing other pages. The word has to be
  the page noun the title is built on ("Projects Index", "Member Directory"),
  which is what the bare word match approximates; the model gate catches a
  title that uses the word inside a real event.
*/
function directoryIndexStamp(lead: LeadLike): StandingPageStamp | null {
  const title = lead.headline ?? "";
  if (/\b(directory|index)\b/i.test(title)) {
    return { rule: "R2", reason: "title names a directory/index page, not an event" };
  }
  if (sourcePaths(lead.source_urls).some((p) => /\/(directory|index)\/?$/i.test(p))) {
    return { rule: "R2", reason: "source URL is a directory/index page" };
  }
  return null;
}

/*
  R3 -- projects / funds index page (evergreen pattern).

  A foundation's projects index is a catalogue of funds that already exist. The
  news would be one NEW grant from it. The URL half matches `/projects/<slug>`
  (the index) but NOT `/project/<slug>` (one project's own page) and not the
  `/feed` of the index -- lead 286, the Ascend scholarship, is a single
  `/project/...` page the editor published.
*/
function projectsIndexStamp(lead: LeadLike): StandingPageStamp | null {
  const title = lead.headline ?? "";
  if (/\b(projects?|funds?)\s+(index|directory|listing|page)\b/i.test(title)) {
    return { rule: "R3", reason: "title names a projects/funds index page" };
  }
  if (sourcePaths(lead.source_urls).some((p) => /\/projects\/[^/]+\/?$/.test(p))) {
    return { rule: "R3", reason: "source URL is a projects index page" };
  }
  return null;
}

/*
  R4 -- events listing (page-change rule).

  Two or more single-event pages cited as the sources, with no dated event in
  the title, means the candidate is the LISTING, not one event. Compare lead
  211, "Recovery Cafe Longmont lists meditation, film and recovery-circle
  sessions for Sept. 25": three event pages, but the title carries "Sept. 25"
  -- an event -- so this rule leaves it alone and the model decides.
*/
function eventsListingStamp(lead: LeadLike): StandingPageStamp | null {
  const title = lead.headline ?? "";
  const eventPaths = sourcePaths(lead.source_urls).filter((p) => /\/events?\//i.test(p)).length;
  if (eventPaths >= 2 && !titleCarriesEventDate(title)) {
    return {
      rule: "R4",
      reason: `lists ${eventPaths} event pages with no dated event in the title`,
    };
  }
  return null;
}

/*
  R5 -- a bare meeting record (news values: a meeting is news when something is
  decided, proposed or disputed, not when a record is posted).

  "Planning and Zoning Commission 9/16/26" and "Historic Preservation
  Commission - October 1, 2026" are the video/agenda titles of two routine
  meetings -- the agenda posted, the minutes posted, nothing decided -- and the
  scan filed both as leads. A headline whose only content is the body's name
  and a date says only that the meeting happened; the news, if any, is what was
  decided in it, and that belongs to the meeting-capture transcript path.

  Three conditions, all cheap:
    - the title carries a date (no date, no record);
    - the title names a public body (council, commission, board, committee,
      authority, trustees, panel -- with any qualifier words: "Historic
      Preservation Commission", "Board of Adjustment");
    - nothing in the title is news: at most a few words are left once the body,
      the date and the meeting vocabulary (session, meeting, agenda, minutes,
      hearing, packet, consent, item, remarks ...) are removed, and none of them
      is a decision/action word (approve, vote, reject, propose, postpone,
      confirm, cut, hire ...). "Board of Adjustment meets Oct. 3" is a record;
      "Board of Adjustment denies the variance" is news and is left alone.

  Guard: a headline ending in a parenthesized machine timestamp -- "City Council
  Regular Session - September 22, 2026 (2026-09-23)" -- is written only by the
  meeting-capture path (./meeting-lead.ts `meetingLeadCopy`), which files a lead
  only for an ALIGNED transcript. Those leads are transcript-stories the desk
  has the recording for, not bare records, so this rule leaves them to the
  model. That is the whole difference between the published council-session
  leads and the two records this rule drops.
*/
const MEETING_BODY_NOUN =
  /^(council|councils|commission|commissions|commissioners|board|boards|committee|committees|authority|authorities|trustees|panel|panels)$/;

/** Words that name a meeting or its paperwork rather than an event in it. */
const MEETING_RECORD_WORDS = new Set(
  (
    "meeting meetings session sessions regular special study worksession work " +
    "agenda agendas minutes packet packets hearing hearings presession pre call " +
    "order roll pledge allegiance remarks comments report reports presentation " +
    "presentations consent business item items reading readings ordinance " +
    "ordinances resolution resolutions new old first second third public invited " +
    "be heard member members from to of and the a an at on in for with"
  ).split(/\s+/),
);

/** A decision, proposal or dispute: the presence of one means this is news. */
const MEETING_ACTION_WORD =
  /\b(approv\w*|reject\w*|den(?:y|ies|ied)|vote[sd]?|voting|pass(?:ed|es)?|adopt\w*|decid\w*|decision|postpon\w*|delay\w*|propos\w*|disput\w*|debat\w*|confirm\w*|flag\w*|back(?:ed|s)?|block\w*|halt\w*|sign(?:ed|s)?|veto\w*|ok(?:s|'d)?|kill\w*|settl\w*|award\w*|hir(?:e|ed|es|ing)|fir(?:e|ed|es|ing)|appoint\w*|elect\w*|su(?:ed|es)|fin(?:ed|es)|rais(?:e|ed|es)|cuts?|sets?|axe[sd]?|greenlight\w*|agree\w*|table[sd]?|unanimous|announc\w*|reopen\w*|launch\w*|fund\w*|budget\w*|contract\w*|pay(?:s|ment|ments)?|paid|spend\w*|purchas\w*|sell\w*|sold|build\w*|expands?|expand(?:ed|s|ing)?|reduc\w*|increas\w*|tax(?:es)?|fees?|rates?|deadline\w*|applicat\w*|cancel\w*)\b/i;

/** A parenthesized machine timestamp: the meeting-capture transcript-lead form. */
const CAPTURE_STAMP = /\(\s*\d{4}-\d{2}-\d{2}/;

const MONTH_WORD = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/;

function meetingRecordStamp(lead: LeadLike): StandingPageStamp | null {
  const title = lead.headline ?? "";
  if (CAPTURE_STAMP.test(title)) return null; // transcript-story, not a bare record
  const cleaned = title.replace(/\([^)]*\)/g, " ").replace(/&amp;/g, "&");
  if (!titleCarriesEventDate(cleaned) && !/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(cleaned)) return null;
  const words = cleaned.toLowerCase().match(/[a-z]+|\d+(?:\/\d+)*/g) ?? [];
  const bodyAt = words.findIndex((w) => MEETING_BODY_NOUN.test(w));
  if (bodyAt < 0) return null;
  if (MEETING_ACTION_WORD.test(cleaned)) return null;
  const isDateWord = (w: string) =>
    MONTH_WORD.test(w) || /^\d+(?:\/\d+)+$/.test(w) || /^\d{4}-\d{2}-\d{2}$/.test(w) || /^\d{1,4}$/.test(w);
  let extra = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i === bodyAt || isDateWord(w) || MEETING_RECORD_WORDS.has(w)) continue;
    extra++;
  }
  if (extra > 3) return null; // real content beside the body: leave it to the model
  return {
    rule: "R5",
    reason: "headline is only a meeting body and a date — a record that the meeting was held, not news from it",
  };
}

const STANDING_PAGE_RULES = [obituaryIndexStamp, directoryIndexStamp, projectsIndexStamp, eventsListingStamp, meetingRecordStamp];

/**
 * Stamp a candidate that is a standing page rather than a news event, or null
 * when no rule fires.
 *
 * Cheap, deterministic, and explainable: the caller drops the candidate and can
 * tell the editor which rule and why. This runs BEFORE the model so an obvious
 * page costs no tokens and gets no lead row.
 */
export function standingPageStamp(lead: LeadLike): StandingPageStamp | null {
  for (const rule of STANDING_PAGE_RULES) {
    const stamp = rule(lead);
    if (stamp) return stamp;
  }
  return null;
}

/**
 * The model's own verdict, read strictly: only an explicit `is_event === false`
 * is a "no". A reply that predates the field, or one that omits it, is not a
 * verdict -- an absent answer must never drop a lead.
 *
 * The reason names the model's event sentence when it wrote one, so the scan
 * summary can say what the model saw ("no event: 'the page lists the cafe's
 * hours'"). Reuters Tracer's rule: the decision stays explainable.
 */
export function noEventVerdict(lead: LeadEventFields): { reason: string } | null {
  if (lead.is_event !== false) return null;
  const event = (lead.event ?? "").trim();
  const detail = event ? `: ${event.slice(0, 160)}` : "";
  return { reason: `the scan read no news event${detail}` };
}
