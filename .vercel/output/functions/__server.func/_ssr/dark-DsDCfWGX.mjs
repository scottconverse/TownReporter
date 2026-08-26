import { c as getSql } from "./paper-DHP8VcIV.mjs";
import { r as createServerFn } from "./ssr.mjs";
import { a as parseJsonBlock, i as grokChat, r as createServerRpc } from "./ai-BuLkq9Lu.mjs";
import { t as deskMiddleware } from "./desk-auth-DF6Ki2aL.mjs";
import { a as audit, c as classifyFetchedPage, d as ingestDocument, h as sha256, i as assertRate, l as classifySearchHtml, m as sanitizePublicUrls, o as canonicalPublicUrl, r as assertHttpUrl, s as chunksFromEvidence, t as ARCHIVE_TEXT_CAP, u as fetchPublicHttp } from "./schema-BpVNHEpo.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/dark-DsDCfWGX.js
var DARK_SYSTEM = `TOWNREPORTER — DARK DESK: INVESTIGATIVE DISCOVERY ENGINE
CITY: Longmont, Colorado.
Governing principle: Search broadly. Dig recursively. Preserve evidence. Challenge conclusions. Report accurately.

You are not a summarizer of a preassembled packet. You notice something odd, ask why, search, find new sources, extract names, search those, follow references, compare history, notice disappearances and absences, connect entities, test competing explanations, and keep digging.

The watch list is the BEGINNING of an investigation, never the boundary.
A newly discovered public URL is an investigative artifact. Source quality affects how a fact is evaluated, not whether you may look.

RULE 1 — COORDINATION IS NOT DECEPTION.
Neighborhood associations, unions, churches, advocacy talking points: normal, legal, healthy. Not astroturfing.
The story is never "these people were organized." Only: UNDISCLOSED SPONSORSHIP, FABRICATED IDENTITY, or MANUFACTURED SCALE.

RULE 2 — PRIVATE CITIZENS IN AGGREGATE ONLY.
Never unmask an anonymous account or compile a private resident's civic participation to characterize them.
Public officials in official capacity, organizations, businesses, paid lobbyists, and applicants seeking public action ARE in scope.

RULE 3 — ALLEGING PAID DECEPTION IS DEFAMATION-GRADE.
Pattern inference = a QUESTION until documents say otherwise.

CLAIM KINDS (do not cap confidence):
FACT — directly supported.
OBSERVATION — TownReporter detected it.
ALLEGATION — a source claimed it.
INFERENCE — derived from facts.
HYPOTHESIS — being tested.
UNKNOWN — unresolved.
Confidence reflects evidence, 0–1. No 0.5 ceiling.

POSTURES
1. Dog that didn't bark — absence vs EXPECTED CADENCE.
2. Whisper in the crowd — 3+ independent reports.
3. Fiscal fray — money moving without narrative.
4. Chorus that rhymes — concealment/fabrication/faked scale, never mere coordination.
5. The web — disclosed vs undisclosed connections.

When evidence points toward an LLC, agent, parcel, RFP, prior agreement, missing report, or cached copy: GO GET IT. Then follow the next hop. Five or more hops is normal. Do not stop because the URL was not on the watch list.

For every serious hypothesis also search the innocent explanation.

Return ONLY JSON:
{
  "window": "date range or unknown",
  "inventory_gaps": ["string"],
  "editor_summary": "what was found, what was searched, what remains",
  "promises": [{"who":"","what":"","when_due":"","source_cite":"","status":"open|returned|unclear"}],
  "signals": [{
    "name": "",
    "posture": "Dog That Didn't Bark|Whisper|Fiscal Fray|Chorus|Web",
    "type": "",
    "strength": 3,
    "confidence": 0.4,
    "observation": "",
    "pattern": "",
    "linkage_map": "",
    "alternatives": "",
    "counter_narrative": "COMPLETED|NOT REQUIRED|INCOMPLETE — notes",
    "what_would_kill": "",
    "pathway": "next searches and documents",
    "privacy_review": "none | aggregate only",
    "handoff": "DISCARD|HOLD FOR PATTERN|MONITOR|FOR VERIFICATION|CONTINUE|FINDING|DEAD END"
  }]
}`;
var DARK_PLANNER = `TOWNREPORTER Dark Desk planner. Longmont, Colorado.
You are mid-investigation. Produce the NEXT hop: new searches, URLs to fetch, entities, relationships, hypotheses (with supporting AND contradicting searches), claims with kinds, frontier items, anomalies, dead ends.

Search must generate search. If you learned a person's name from a company search, search the person. If you learned an address, search the parcel. Do not summarize and stop.

Watch-list origin is irrelevant. Any public URL is fair game for fetch_urls.
Never fetch localhost, RFC1918, or metadata IPs.
Cite capture: and version: IDs from the artifacts in context on every claim and relationship. If you cannot identify the supporting capture, omit the IDs rather than guessing.

Return ONLY JSON:
{
  "searches": ["query", "contradicting query"],
  "fetch_urls": ["https://..."],
  "entities": [{"name":"","kind":"person|company|agency|parcel|contract|other","why":""}],
  "relationships": [{"from":"","to":"","kind":"","evidence":"","source_url":"","artifact_version_id":null,"capture_event_id":null,"locator":""}],
  "hypotheses": [{"text":"","supporting":"","contradicting":""}],
  "claims": [{"text":"","kind":"FACT|OBSERVATION|ALLEGATION|INFERENCE|HYPOTHESIS|UNKNOWN","evidence":"","source_url":"","confidence":0.0,"artifact_version_id":null,"capture_event_id":null,"locator":""}],
  "frontier": [{"label":"","kind":"","why":"","priority":8,"queries":[]}],
  "anomalies": [{"kind":"missing|changed|disappeared|absence","summary":"","url":""}],
  "dead_ends": [{"hypothesis":"","reason":""}],
  "questions": [""],
  "stop": false,
  "summary": "what this hop did and what remains"
}`;
var LLC_RE = /\b([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,5}\s+(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?))\b/g;
var CONTRACT_RE = /\b(?:contract|agreement|po|purchase order)\s*#?\s*([A-Z0-9][A-Z0-9\/-]{3,})\b/gi;
var RFP_RE = /\b(?:RFP|RFQ|IFB)[\s#:.-]*([A-Z0-9][A-Z0-9\/-]{2,})\b/gi;
var ORD_RE = /\b(?:ordinance|resolution)\s*(?:no\.?|number|#)?\s*([A-Z0-9][A-Z0-9\/-]{2,})\b/gi;
var PARCEL_RE = /\b(?:parcel|AIN|assessor(?:'s)? (?:id|number)|PIN)\s*[:#]?\s*([A-Z0-9-]{5,})\b/gi;
var DATED_RE = /\b(?:pursuant to|according to|as previously approved|amended by|under|see attachment|as discussed(?: at)?|prepared by|submitted by)\b[^.\n]{5,120}/gi;
var URL_RE = /https?:\/\/[^\s<>"'\\)\]]+/gi;
var AGENT_RE = /\b(?:registered agent|principal|prepared by|submitted by|applicant)\s*[:\-–]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
var CASE_RE = /\b((?:PLN|SP|CUP|ANX|PLAN)[- ]?\d{2,4}[- ]?\d+)\b/gi;
var MONEY_RE = /\$[\d,]+(?:\.\d{2})?/g;
function extractReferences(text) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const push = (kind, value) => {
		const v = value.replace(/\s+/g, " ").trim().slice(0, 240);
		if (v.length < 3) return;
		const key = `${kind}:${v.toLowerCase()}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push({
			kind,
			value: v
		});
	};
	let m;
	LLC_RE.lastIndex = 0;
	while (m = LLC_RE.exec(text)) push("company", m[1]);
	CONTRACT_RE.lastIndex = 0;
	while (m = CONTRACT_RE.exec(text)) push("contract", m[1]);
	RFP_RE.lastIndex = 0;
	while (m = RFP_RE.exec(text)) push("rfp", m[0].replace(/\s+/g, " "));
	ORD_RE.lastIndex = 0;
	while (m = ORD_RE.exec(text)) push("legislation", m[0].replace(/\s+/g, " "));
	PARCEL_RE.lastIndex = 0;
	while (m = PARCEL_RE.exec(text)) push("parcel", m[1]);
	DATED_RE.lastIndex = 0;
	while (m = DATED_RE.exec(text)) push("reference", m[0]);
	URL_RE.lastIndex = 0;
	while (m = URL_RE.exec(text)) push("url", m[0].replace(/[.,;:]+$/, ""));
	AGENT_RE.lastIndex = 0;
	while (m = AGENT_RE.exec(text)) push("person", m[1]);
	CASE_RE.lastIndex = 0;
	while (m = CASE_RE.exec(text)) push("planning", m[1]);
	MONEY_RE.lastIndex = 0;
	while (m = MONEY_RE.exec(text)) push("amount", m[0]);
	return out.slice(0, 80);
}
function queriesForRef(ref, city = "Longmont") {
	const v = ref.value;
	switch (ref.kind) {
		case "company": return [
			`"${v}" ${city}`,
			`"${v}" "registered agent" Colorado`,
			`"${v}" campaign contribution`,
			`"${v}" contract OR RFP OR bid`
		];
		case "contract": return [`"${v}" ${city} contract`, `"${v}" RFP`];
		case "rfp": return [`${v} ${city}`, `${v} proposal`];
		case "parcel": return [`parcel ${v} ${city}`, `${v} assessor ${city}`];
		case "legislation": return [`${v} ${city}`, `${v} minutes`];
		case "person": return [
			`"${v}" ${city}`,
			`"${v}" "registered agent" Colorado`,
			`"${v}" campaign contribution`,
			`"${v}" planning`
		];
		case "planning": return [
			`${v} ${city}`,
			`${v} planning`,
			`${v} campaign contribution`
		];
		case "url": return [];
		default: return [`"${v}" ${city}`];
	}
}
function heuristicPlan$1(text, tried, searchesPerHop = 3, fetchesPerHop = 4) {
	const refs = extractReferences(text);
	const searches = [];
	const fetch_urls = [];
	const frontier = [];
	for (const ref of refs) if (ref.kind === "url") fetch_urls.push(ref.value);
	else {
		frontier.push({
			label: ref.value,
			kind: ref.kind,
			why: "Referenced in evidence; not yet searched",
			priority: ref.kind === "company" || ref.kind === "contract" ? 9 : 6,
			queries: queriesForRef(ref)
		});
		for (const q of queriesForRef(ref)) if (!tried.has(q)) searches.push(q);
	}
	return {
		searches: searches.slice(0, searchesPerHop),
		fetch_urls: fetch_urls.slice(0, fetchesPerHop),
		frontier,
		summary: `Heuristic hop: ${Math.min(searches.length, searchesPerHop)} searches, ${Math.min(fetch_urls.length, fetchesPerHop)} fetches, ${frontier.length} frontier items.`
	};
}
function detectMissingCadence(events, now, cadenceDays, graceDays = 7) {
	const last = /* @__PURE__ */ new Map();
	for (const e of events) {
		const prev = last.get(e.key);
		if (!prev || e.at > prev.at) last.set(e.key, e);
	}
	const out = [];
	for (const e of last.values()) {
		const late = (now.getTime() - e.at.getTime()) / 864e5 - cadenceDays;
		if (late > graceDays) out.push({
			key: e.key,
			daysLate: Math.round(late),
			lastSeen: e.at,
			title: e.title,
			url: e.url
		});
	}
	return out;
}
function nthWeekday(d) {
	return `${Math.ceil(d.getUTCDate() / 7)}-${d.toLocaleDateString("en-US", {
		weekday: "long",
		timeZone: "UTC"
	})}`;
}
function structureSnapshot(title, text, extras = []) {
	return {
		title,
		attachmentCount: extras.length,
		hasAppendixC: /appendix\s*c/i.test(text),
		headingCount: (text.match(/\b(agenda|minutes|staff report|ordinance|resolution|consent)\b/gi) ?? []).length,
		length: text.length
	};
}
function detectPatternAnomalies(opts) {
	const out = [];
	const prev = opts.previous;
	if (prev) {
		if (prev.title && opts.current.title && prev.title !== opts.current.title) out.push({
			kind: "renamed",
			summary: `Title changed from "${prev.title}" to "${opts.current.title}"`,
			details: "Recurring record appears under a new title."
		});
		if (prev.attachmentCount > 0 && opts.current.attachmentCount < prev.attachmentCount) out.push({
			kind: "attachment-omitted",
			summary: `Attachments dropped from ${prev.attachmentCount} to ${opts.current.attachmentCount}`,
			details: "Packet normally includes more attachments than this capture."
		});
		if (prev.hasAppendixC && !opts.current.hasAppendixC) out.push({
			kind: "structurally-altered",
			summary: "Expected Appendix C is absent",
			details: "Prior capture of this recurring record included Appendix C."
		});
		if (prev.length > 2e3 && opts.current.length < prev.length * .4) out.push({
			kind: "structurally-altered",
			summary: "Recurring document is much shorter than the learned baseline",
			details: `Prior length ${prev.length}, current ${opts.current.length}.`
		});
	}
	if (opts.usualNthWeekday && opts.observedAt && nthWeekday(opts.observedAt) !== opts.usualNthWeekday) out.push({
		kind: "cadence-shifted",
		summary: `Expected ${opts.usualNthWeekday}, observed ${nthWeekday(opts.observedAt)}`,
		details: "Publication weekday/nth pattern shifted from the learned baseline."
	});
	if (opts.usualAttachmentCount != null && opts.usualAttachmentCount > 0 && opts.current.attachmentCount < opts.usualAttachmentCount) out.push({
		kind: "attachment-omitted",
		summary: `Usual attachment count ${opts.usualAttachmentCount}, this capture ${opts.current.attachmentCount}`,
		details: "Learned packet structure is missing attachments."
	});
	if (opts.usualLeadHours != null && opts.usualLeadHours >= 24 && opts.currentLeadHours != null && opts.currentLeadHours < opts.usualLeadHours * .5) out.push({
		kind: "late",
		summary: `Posted ${opts.currentLeadHours}h before the meeting; usual lead is ${opts.usualLeadHours}h`,
		details: "Agenda or packet arrived later than the learned posting window."
	});
	return out;
}
var MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
/** Best-effort meeting/hearing date from civic titles and headers. */
function extractMeetingInstant(text) {
	const named = text.match(new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2},\\s+20\\d{2}\\b`, "i"));
	if (named) {
		const d = /* @__PURE__ */ new Date(`${named[0]} UTC`);
		if (!Number.isNaN(d.getTime())) return d;
	}
	const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
	if (iso) {
		const d = /* @__PURE__ */ new Date(`${iso[1]}T00:00:00Z`);
		if (!Number.isNaN(d.getTime())) return d;
	}
	return null;
}
function leadHoursBefore(captured, meeting) {
	const h = (meeting.getTime() - captured.getTime()) / 36e5;
	if (h <= 0 || h > 504) return null;
	return Math.round(h);
}
function diffExcerpt(prev, next) {
	if (prev === next) return "";
	if (!next) return "Content removed.";
	if (!prev) return "Content appeared.";
	const a = new Set(prev.split(/\s+/).filter((w) => w.length > 4));
	const b = next.split(/\s+/).filter((w) => w.length > 4);
	const added = b.filter((w) => !a.has(w)).slice(0, 24);
	const prevWords = prev.split(/\s+/).filter((w) => w.length > 4);
	const nextSet = new Set(b);
	const removed = prevWords.filter((w) => !nextSet.has(w)).slice(0, 24);
	return [removed.length ? `Removed: ${removed.join(" ")}` : "", added.length ? `Added: ${added.join(" ")}` : ""].filter(Boolean).join("\n");
}
function classifyClaimKind(raw) {
	const k = raw.trim().toUpperCase();
	if (k === "FACT" || k === "OBSERVATION" || k === "ALLEGATION" || k === "INFERENCE" || k === "HYPOTHESIS" || k === "UNKNOWN") return k;
	return "UNKNOWN";
}
function parseDdgHtml(html) {
	const hits = [];
	const seen = /* @__PURE__ */ new Set();
	const re = /uddg=([^&"]+)[^>]*>[\s\S]{0,40}?(?:class="result__a"[^>]*>)?([^<]{0,180})/gi;
	let m;
	while (m = re.exec(html)) {
		let url = "";
		try {
			url = decodeURIComponent(m[1]);
		} catch {
			continue;
		}
		const title = m[2].replace(/<[^>]+>/g, "").trim();
		if (!url.startsWith("http")) continue;
		if (seen.has(url)) continue;
		seen.add(url);
		hits.push({
			title: title || url,
			url,
			snippet: ""
		});
		if (hits.length >= 8) break;
	}
	if (hits.length === 0) {
		const hrefs = html.matchAll(/href="(https?:\/\/[^"]+)"/gi);
		for (const h of hrefs) {
			const url = h[1];
			if (/duckduckgo\.com|javascript:/i.test(url)) continue;
			if (seen.has(url)) continue;
			seen.add(url);
			hits.push({
				title: url,
				url,
				snippet: ""
			});
			if (hits.length >= 8) break;
		}
	}
	return hits.filter((h) => {
		try {
			assertHttpUrl(h.url);
			return true;
		} catch {
			return false;
		}
	});
}
function parseWaybackCdx(raw) {
	const out = [];
	try {
		const data = JSON.parse(raw);
		if (!Array.isArray(data)) return out;
		for (const row of data.slice(1, 8)) {
			if (!Array.isArray(row) || row.length < 3) continue;
			const ts = String(row[1] ?? "");
			const original = String(row[2] ?? "");
			if (ts && original) out.push(`https://web.archive.org/web/${ts}/${original}`);
		}
	} catch {
		const lines = raw.split("\n").filter(Boolean);
		for (const line of lines.slice(0, 6)) {
			const parts = line.split(/\s+/);
			if (parts.length >= 3) out.push(`https://web.archive.org/web/${parts[1]}/${parts[2]}`);
		}
	}
	return out.filter((u) => {
		try {
			assertHttpUrl(u);
			return true;
		} catch {
			return false;
		}
	});
}
function parseWikipediaOpenSearch(raw) {
	try {
		const data = JSON.parse(raw);
		if (!Array.isArray(data) || data.length < 4) return [];
		const titles = data[1];
		const snippets = data[2];
		const urls = data[3];
		const hits = [];
		for (let i = 0; i < urls.length && hits.length < 8; i++) {
			const url = String(urls[i] ?? "");
			if (!url.startsWith("http")) continue;
			try {
				assertHttpUrl(url);
			} catch {
				continue;
			}
			hits.push({
				title: String(titles[i] ?? url),
				url,
				snippet: String(snippets[i] ?? "")
			});
		}
		return hits;
	} catch {
		return [];
	}
}
async function searchDdg(query) {
	const url = new URL("https://html.duckduckgo.com/html/");
	url.searchParams.set("q", query);
	try {
		const res = await fetchPublicHttp(url);
		const html = await res.text();
		const hits = parseDdgHtml(html);
		const state = classifySearchHtml(res.status, html, hits.length);
		return {
			state,
			hits: state.startsWith("SEARCH_SUCCESS") ? hits : [],
			provider: "ddg-html"
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : "network";
		return {
			state: /timeout|aborted/i.test(msg) ? "SEARCH_TIMEOUT" : "SEARCH_FAILED_NETWORK",
			hits: [],
			provider: "ddg-html",
			error: msg
		};
	}
}
async function searchDdgLite(query) {
	const url = new URL("https://lite.duckduckgo.com/lite/");
	url.searchParams.set("q", query);
	try {
		const res = await fetchPublicHttp(url);
		const html = await res.text();
		const hits = parseDdgHtml(html);
		const state = classifySearchHtml(res.status, html, hits.length);
		return {
			state,
			hits: state.startsWith("SEARCH_SUCCESS") ? hits : [],
			provider: "ddg-lite"
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : "network";
		return {
			state: /timeout|aborted/i.test(msg) ? "SEARCH_TIMEOUT" : "SEARCH_FAILED_NETWORK",
			hits: [],
			provider: "ddg-lite",
			error: msg
		};
	}
}
async function searchWikipedia(query) {
	const url = new URL("https://en.wikipedia.org/w/api.php");
	url.searchParams.set("action", "opensearch");
	url.searchParams.set("search", query);
	url.searchParams.set("limit", "8");
	url.searchParams.set("format", "json");
	try {
		const res = await fetchPublicHttp(url);
		if (!res.ok) return {
			state: "SEARCH_FAILED_PROVIDER",
			hits: [],
			provider: "wikipedia",
			error: `HTTP ${res.status}`
		};
		const raw = await res.text();
		const hits = parseWikipediaOpenSearch(raw);
		if (hits.length) return {
			state: "SEARCH_SUCCESS_RESULTS",
			hits,
			provider: "wikipedia"
		};
		if (!raw.trim()) return {
			state: "SEARCH_FAILED_PARSE",
			hits: [],
			provider: "wikipedia"
		};
		return {
			state: "SEARCH_SUCCESS_ZERO_RESULTS",
			hits: [],
			provider: "wikipedia"
		};
	} catch (err) {
		return {
			state: "SEARCH_FAILED_NETWORK",
			hits: [],
			provider: "wikipedia",
			error: err instanceof Error ? err.message : "network"
		};
	}
}
function pickSearchResult(attempts) {
	if (!attempts.length) return {
		state: "SEARCH_SUCCESS_ZERO_RESULTS",
		hits: [],
		provider: "none",
		lineage: []
	};
	const results = attempts.find((a) => a.state === "SEARCH_SUCCESS_RESULTS");
	if (results) return {
		...results,
		lineage: attempts
	};
	const zero = attempts.find((a) => a.state === "SEARCH_SUCCESS_ZERO_RESULTS");
	if (zero) return {
		...zero,
		lineage: attempts
	};
	return {
		...attempts[attempts.length - 1],
		lineage: attempts
	};
}
/** DDG HTML, then DDG lite, then Wikipedia. Failures fall through. Zero on one provider still tries the next. */
async function searchWithFallback(query) {
	const q = query.trim().slice(0, 180);
	if (!q) return {
		state: "SEARCH_SUCCESS_ZERO_RESULTS",
		hits: [],
		provider: "none",
		lineage: []
	};
	const lineage = [];
	for (const fn of [
		searchDdg,
		searchDdgLite,
		searchWikipedia
	]) {
		const attempt = await fn(q);
		lineage.push(attempt);
		if (attempt.state === "SEARCH_SUCCESS_RESULTS") return {
			...attempt,
			lineage
		};
	}
	return pickSearchResult(lineage);
}
async function waybackCopies(target) {
	try {
		const api = new URL("https://web.archive.org/cdx/search/cdx");
		api.searchParams.set("url", target);
		api.searchParams.set("output", "json");
		api.searchParams.set("limit", "5");
		api.searchParams.set("filter", "statuscode:200");
		const res = await fetchPublicHttp(api);
		if (!res.ok) return [];
		return parseWaybackCdx(await res.text());
	} catch {
		return [];
	}
}
/** Matching key that strips legal suffixes — for comparison only, never a merge key. */
function normalizeEntity(name) {
	return name.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").replace(/\b(llc|l\.l\.c\.|inc|corp|corporation|ltd|the)\b/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
}
/** Stable identity key. Keeps LLC/Inc so two legal names stay two entities. */
function identityKey(name) {
	return name.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").slice(0, 160);
}
function isConfirmedSame(verdict) {
	return verdict === "same" || verdict === "confirmed-same";
}
function resolveEntityName(name, known) {
	const key = identityKey(name);
	const n = normalizeEntity(name);
	if (!key) return {
		verdict: "unresolved",
		canonical: key
	};
	for (const k of known) {
		const kKey = identityKey(k.name) || k.canonical;
		if (kKey === key || k.canonical === key) return {
			verdict: "same",
			canonical: k.canonical,
			matched: k.name
		};
		const kn = normalizeEntity(k.name) || k.canonical;
		if (n && kn && n === kn && kKey !== key) return {
			verdict: "possible-same",
			canonical: k.canonical,
			matched: k.name
		};
		const a = new Set(n.split(" ").filter((w) => w.length > 1));
		const b = new Set(kn.split(" ").filter((w) => w.length > 1));
		const inter = [...a].filter((w) => b.has(w));
		if (inter.length >= 2 && inter.length === Math.min(a.size, b.size) && Math.abs(a.size - b.size) <= 1) return {
			verdict: "likely-same",
			canonical: k.canonical,
			matched: k.name
		};
		if (inter.length >= 2) return {
			verdict: "possible",
			canonical: k.canonical,
			matched: k.name
		};
		if (n && kn && (n.includes(kn) || kn.includes(n))) {
			if (Math.min(n.length, kn.length) >= 6) return {
				verdict: "possible",
				canonical: k.canonical,
				matched: k.name
			};
		}
	}
	return {
		verdict: "unresolved",
		canonical: key
	};
}
function strategiesForFrontier(kind, label, city = "Longmont") {
	const v = label.trim();
	if (!v) return [];
	const stripped = v.replace(/\s+(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?)\.?$/i, "").trim();
	switch (kind) {
		case "company": return [
			{
				key: "exact-name",
				query: `"${v}" ${city}`
			},
			{
				key: "stripped-suffix",
				query: `"${stripped}" ${city}`
			},
			{
				key: "registered-agent",
				query: `"${v}" "registered agent" Colorado`
			},
			{
				key: "owner-officer",
				query: `"${v}" (owner OR officer OR principal) Colorado`
			},
			{
				key: "address",
				query: `"${v}" (address OR street OR "registered office") ${city}`
			},
			{
				key: "state-corporate",
				query: `"${v}" site:sos.state.co.us`
			},
			{
				key: "parcel",
				query: `"${v}" (parcel OR assessor) ${city}`
			},
			{
				key: "contract",
				query: `"${v}" (contract OR RFP OR bid) ${city}`
			},
			{
				key: "site-gov",
				query: `"${v}" site:longmontcolorado.gov`
			},
			{
				key: "historical-archive",
				query: `"${v}" (wayback OR archive.org)`
			}
		];
		case "person": return [
			{
				key: "exact-name",
				query: `"${v}" ${city}`
			},
			{
				key: "registered-agent",
				query: `"${v}" "registered agent" Colorado`
			},
			{
				key: "owner-officer",
				query: `"${v}" (officer OR principal OR director) Colorado`
			},
			{
				key: "campaign",
				query: `"${v}" campaign contribution`
			},
			{
				key: "planning",
				query: `"${v}" planning ${city}`
			},
			{
				key: "address",
				query: `"${v}" (address OR street) ${city}`
			},
			{
				key: "historical-archive",
				query: `"${v}" (wayback OR archive.org)`
			}
		];
		case "parcel": return [
			{
				key: "exact-name",
				query: `parcel ${v} ${city}`
			},
			{
				key: "assessor",
				query: `${v} assessor ${city}`
			},
			{
				key: "owner-officer",
				query: `parcel ${v} owner`
			},
			{
				key: "site-gov",
				query: `${v} site:longmontcolorado.gov`
			}
		];
		case "contract":
		case "rfp":
		case "legislation":
		case "planning": return [
			{
				key: "exact-name",
				query: `"${v}" ${city}`
			},
			{
				key: "site-gov",
				query: `"${v}" site:longmontcolorado.gov`
			},
			{
				key: "contract",
				query: `"${v}" (contract OR RFP OR bid OR ordinance)`
			},
			{
				key: "historical-archive",
				query: `"${v}" (wayback OR archive.org)`
			}
		];
		case "url":
		case "missing-record": return [{
			key: "exact-name",
			query: v
		}, {
			key: "historical-archive",
			query: `"${v}" (wayback OR archive.org OR relocated)`
		}];
		default: return [
			{
				key: "exact-name",
				query: `"${v}" ${city}`
			},
			{
				key: "stripped-suffix",
				query: `"${stripped}" ${city}`
			},
			{
				key: "historical-archive",
				query: `"${v}" (wayback OR archive.org)`
			}
		];
	}
}
function strategyKeyForQuery(kind, label, query) {
	const q = query.trim().toLowerCase();
	for (const s of strategiesForFrontier(kind, label)) if (s.query.trim().toLowerCase() === q) return s.key;
	if (/\baddress\b|\bstreet\b|\bcoffman\b|\bmain street\b/i.test(query)) return "address";
	if (/registered agent/i.test(query)) return "registered-agent";
	if (/site:sos\.state\.co\.us/i.test(query)) return "state-corporate";
	if (/wayback|archive\.org/i.test(query)) return "historical-archive";
	if (/parcel|assessor/i.test(query)) return "parcel";
	if (/contract|rfp|bid/i.test(query)) return "contract";
	const stripped = label.replace(/\s+(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?)\.?$/i, "").trim().toLowerCase();
	if (stripped && q.includes(stripped) && !q.includes(label.trim().toLowerCase())) return "stripped-suffix";
	return "adhoc";
}
function remainingStrategies(kind, label, triedKeys) {
	const tried = new Set(triedKeys);
	return strategiesForFrontier(kind, label).filter((s) => !tried.has(s.key));
}
function queryFingerprint(query) {
	return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 300);
}
var SCHEMA_SQL = `
alter table snapshots add column if not exists url text;
alter table snapshots add column if not exists fetch_status integer;
alter table leads add column if not exists investigation_id integer;
create table if not exists investigations (
  id serial primary key,
  user_id text not null,
  title text not null,
  status text not null default 'open',
  summary text not null default '',
  hops integer not null default 0,
  budget integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists frontier_items (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  kind text not null,
  label text not null,
  why text not null default '',
  evidence text not null default '',
  priority integer not null default 5,
  queries_tried text not null default '[]',
  next_steps text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create table if not exists artifacts (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  url text not null,
  referrer_url text,
  query text,
  title text not null default '',
  content_type text not null default 'html',
  content_hash text not null,
  full_text text not null default '',
  classification text not null default 'discovered',
  fetch_status integer,
  created_at timestamptz not null default now()
);
create table if not exists entities (
  id serial primary key,
  user_id text not null,
  canonical text not null,
  name text not null,
  kind text not null,
  why text not null default '',
  unique (user_id, canonical)
);
create table if not exists relationships (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  from_name text not null,
  to_name text not null,
  kind text not null,
  evidence text not null default '',
  source_url text,
  created_at timestamptz not null default now()
);
create table if not exists claims (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  body text not null,
  kind text not null,
  evidence text not null default '',
  source_url text,
  confidence numeric,
  created_at timestamptz not null default now()
);
create table if not exists hypotheses (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  body text not null,
  supporting text not null default '',
  contradicting text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create table if not exists anomalies (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  kind text not null,
  summary text not null,
  url text,
  details text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists dead_ends (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  hypothesis text not null,
  why_interesting text not null default '',
  searches text not null default '',
  entities text not null default '',
  dismissed_because text not null default '',
  unresolved text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists search_log (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  hop integer not null,
  query text not null,
  results_json text not null default '[]',
  created_at timestamptz not null default now()
);
create table if not exists recurring_baselines (
  id serial primary key,
  user_id text not null,
  key text not null,
  kind text not null,
  cadence_days integer not null default 30,
  last_seen timestamptz,
  typical_title text not null default '',
  typical_url text not null default '',
  unique (user_id, key)
);
create table if not exists artifact_versions (
  id serial primary key,
  user_id text not null,
  url text not null,
  content_hash text not null,
  title text not null default '',
  full_text text not null default '',
  fetch_status integer,
  fetch_outcome text not null default 'fetched',
  content_type text not null default 'html',
  captured_at timestamptz not null default now(),
  unique (user_id, url, content_hash)
);
create table if not exists entity_aliases (
  id serial primary key,
  user_id text not null,
  canonical text not null,
  alias text not null,
  verdict text not null default 'unresolved',
  evidence text not null default '',
  unique (user_id, canonical, alias)
);
create table if not exists capture_events (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  source_url text not null,
  observed_at timestamptz not null default now(),
  http_status integer,
  fetch_outcome text not null,
  redirect_chain text not null default '[]',
  version_id integer,
  disappearance boolean not null default false,
  soft_404 boolean not null default false,
  trigger_kind text not null default 'investigation',
  monitor_id integer,
  headers_json text not null default '{}',
  content_hash text,
  content_type text not null default '',
  extraction_method text not null default ''
);
create table if not exists artifact_chunks (
  id serial primary key,
  version_id integer not null,
  user_id text not null,
  chunk_index integer not null,
  page_number integer,
  section text not null default '',
  excerpt text not null,
  locator text not null default ''
);
create table if not exists investigation_entities (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  entity_id integer not null,
  first_seen_version_id integer,
  first_seen_capture_id integer,
  first_seen_url text,
  relevance text not null default 'direct',
  status text not null default 'active',
  unique (investigation_id, entity_id)
);
create table if not exists entity_matches (
  id serial primary key,
  user_id text not null,
  left_canonical text not null,
  right_canonical text not null,
  verdict text not null default 'unresolved',
  evidence text not null default '',
  capture_event_id integer,
  investigation_id integer,
  unique (user_id, left_canonical, right_canonical)
);
create table if not exists source_monitors (
  id serial primary key,
  user_id text not null,
  url text not null,
  title text not null default '',
  enabled boolean not null default true,
  cadence_hours integer not null default 24,
  next_check_at timestamptz not null default now(),
  last_check_at timestamptz,
  last_success_at timestamptz,
  last_outcome text,
  last_version_id integer,
  expected_cadence_days integer,
  importance integer not null default 5,
  disappearance_sensitive boolean not null default true,
  investigation_id integer,
  typical_structure text not null default '',
  unique (user_id, url)
);
create table if not exists search_attempts (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  search_log_id integer,
  frontier_id integer,
  query text not null,
  provider text not null,
  state text not null,
  hits_json text not null default '[]',
  error text,
  created_at timestamptz not null default now()
);
alter table artifacts add column if not exists version_id integer;
alter table artifacts add column if not exists fetch_outcome text;
alter table artifacts add column if not exists capture_event_id integer;
alter table artifacts add column if not exists extraction_method text;
alter table claims add column if not exists version_id integer;
alter table claims add column if not exists excerpt text;
alter table claims add column if not exists capture_hash text;
alter table claims add column if not exists capture_event_id integer;
alter table claims add column if not exists provenance_status text;
alter table claims add column if not exists locator text;
alter table claims add column if not exists captured_at timestamptz;
alter table relationships add column if not exists version_id integer;
alter table relationships add column if not exists excerpt text;
alter table relationships add column if not exists capture_event_id integer;
alter table relationships add column if not exists capture_hash text;
alter table relationships add column if not exists provenance_status text;
alter table relationships add column if not exists locator text;
alter table frontier_items add column if not exists closed_reason text;
alter table frontier_items add column if not exists strategies_tried text;
alter table frontier_items add column if not exists strategies_budget text;
alter table frontier_items add column if not exists search_zero_count integer;
alter table hypotheses add column if not exists transition_note text;
alter table search_log add column if not exists provider text;
alter table search_log add column if not exists state text;
alter table search_log add column if not exists caused_by text;
alter table search_log add column if not exists frontier_id integer;
alter table search_log add column if not exists hypothesis_id integer;
alter table search_log add column if not exists research_question text;
alter table search_log add column if not exists strategy text;
alter table search_log add column if not exists selected_json text;
alter table search_log add column if not exists fetched_json text;
alter table search_log add column if not exists generated_json text;
alter table search_log add column if not exists query_fingerprint text;
alter table recurring_baselines add column if not exists sightings integer;
alter table recurring_baselines add column if not exists usual_weekday text;
alter table recurring_baselines add column if not exists usual_nth_weekday text;
alter table recurring_baselines add column if not exists usual_lead_hours integer;
alter table recurring_baselines add column if not exists usual_attachment_count integer;
alter table recurring_baselines add column if not exists typical_structure_json text;
alter table artifact_versions add column if not exists extraction_method text;
alter table artifact_versions add column if not exists page_count integer;
alter table artifact_versions add column if not exists raw_ref text;
alter table artifact_versions add column if not exists content_type text;
alter table entity_aliases add column if not exists evidence text;
alter table entity_aliases add column if not exists verdict text;
`;
async function ensureInvestigateSchema() {
	const sql = await getSql();
	for (const stmt of SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) try {
		await sql.query(stmt);
	} catch {}
}
function emptyPlan() {
	return {
		searches: [],
		fetch_urls: [],
		entities: [],
		relationships: [],
		hypotheses: [],
		claims: [],
		frontier: [],
		anomalies: [],
		dead_ends: [],
		questions: [],
		stop: false,
		summary: ""
	};
}
function heuristicPlan(text, tried) {
	const h = heuristicPlan$1(text, tried, 3, 4);
	const plan = emptyPlan();
	plan.searches = h.searches;
	plan.fetch_urls = sanitizePublicUrls(h.fetch_urls);
	plan.frontier = h.frontier;
	plan.summary = h.summary;
	return plan;
}
function numOrUndef(v) {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
}
function parsePlan(raw) {
	const plan = emptyPlan();
	if (!raw || typeof raw !== "object") return plan;
	const o = raw;
	plan.searches = Array.isArray(o.searches) ? o.searches.map(String).slice(0, 8) : [];
	plan.fetch_urls = sanitizePublicUrls(o.fetch_urls).slice(0, 10);
	plan.stop = Boolean(o.stop);
	plan.summary = String(o.summary ?? "").slice(0, 2e3);
	plan.questions = Array.isArray(o.questions) ? o.questions.map(String).slice(0, 12) : [];
	const arr = (key) => Array.isArray(o[key]) ? o[key] : [];
	for (const e of arr("entities")) if (e?.name) plan.entities.push({
		name: String(e.name),
		kind: String(e.kind ?? "unknown"),
		why: String(e.why ?? "")
	});
	for (const r of arr("relationships")) if (r?.from && r?.to) plan.relationships.push({
		from: String(r.from),
		to: String(r.to),
		kind: String(r.kind ?? "related"),
		evidence: String(r.evidence ?? ""),
		source_url: r.source_url ? String(r.source_url) : void 0,
		artifact_version_id: numOrUndef(r.artifact_version_id),
		capture_event_id: numOrUndef(r.capture_event_id),
		locator: r.locator ? String(r.locator) : void 0
	});
	for (const h of arr("hypotheses")) if (h?.text) plan.hypotheses.push({
		text: String(h.text),
		supporting: String(h.supporting ?? ""),
		contradicting: String(h.contradicting ?? "")
	});
	for (const c of arr("claims")) if (c?.text) plan.claims.push({
		text: String(c.text),
		kind: classifyClaimKind(String(c.kind ?? "UNKNOWN")),
		evidence: String(c.evidence ?? ""),
		source_url: c.source_url ? String(c.source_url) : void 0,
		confidence: typeof c.confidence === "number" ? c.confidence : void 0,
		artifact_version_id: numOrUndef(c.artifact_version_id),
		capture_event_id: numOrUndef(c.capture_event_id),
		locator: c.locator ? String(c.locator) : void 0
	});
	for (const f of arr("frontier")) if (f?.label) plan.frontier.push({
		label: String(f.label),
		kind: String(f.kind ?? "unknown"),
		why: String(f.why ?? ""),
		priority: Number(f.priority) || 5,
		queries: Array.isArray(f.queries) ? f.queries.map(String) : []
	});
	for (const a of arr("anomalies")) if (a?.summary) plan.anomalies.push({
		kind: String(a.kind ?? "anomaly"),
		summary: String(a.summary),
		url: a.url ? String(a.url) : void 0
	});
	for (const d of arr("dead_ends")) if (d?.hypothesis) plan.dead_ends.push({
		hypothesis: String(d.hypothesis),
		reason: String(d.reason ?? "")
	});
	return plan;
}
async function grokPlanner(pack) {
	const ai = await grokChat(DARK_PLANNER, pack.slice(0, 24e3), 2200);
	if (!ai.ok) return heuristicPlan(pack, /* @__PURE__ */ new Set());
	return parsePlan(parseJsonBlock(ai.text));
}
async function defaultFetch(url) {
	const doc = await ingestDocument(url);
	return {
		ok: doc.ok,
		status: doc.status,
		text: doc.text,
		title: doc.title,
		extras: doc.extras,
		outcome: doc.outcome,
		redirectChain: doc.redirectChain,
		contentType: doc.contentType,
		extractionMethod: doc.extractionMethod,
		pages: doc.pages,
		needsOcr: doc.needsOcr
	};
}
function parseJsonArray(raw) {
	try {
		const v = JSON.parse(raw || "[]");
		return Array.isArray(v) ? v.map(String) : [];
	} catch {
		return [];
	}
}
async function seedInvestigation(userId, investigationId, paste, snapshotBits) {
	if (paste.trim()) {
		const hash = await sha256(paste);
		await rememberCapture({
			userId,
			investigationId,
			url: "editor://paste",
			title: "Editor paste",
			text: paste.slice(0, ARCHIVE_TEXT_CAP),
			hash,
			status: 200,
			outcome: "fetched",
			classification: "watch",
			triggerKind: "seed"
		});
	}
	for (const snap of snapshotBits.slice(0, 20)) {
		const hash = await sha256(snap.excerpt);
		await rememberCapture({
			userId,
			investigationId,
			url: snap.url,
			title: snap.title,
			text: snap.excerpt.slice(0, ARCHIVE_TEXT_CAP),
			hash,
			status: 200,
			outcome: "fetched",
			classification: "watch",
			triggerKind: "seed"
		});
		await addFrontierFromRefs(userId, investigationId, extractReferences(`${snap.title}\n${snap.excerpt}`), snap.url);
	}
	if (paste.trim()) await addFrontierFromRefs(userId, investigationId, extractReferences(paste), "editor://paste");
}
async function addFrontierFromRefs(userId, investigationId, refs, evidence) {
	for (const ref of refs.slice(0, 30)) await persistDiscovery(userId, investigationId, {
		kind: ref.kind,
		label: ref.value,
		why: "Referenced in evidence",
		evidence: evidence.slice(0, 400),
		priority: ref.kind === "company" || ref.kind === "url" ? 9 : 6,
		query: queriesForRef(ref)[0]
	});
}
async function persistDiscovery(userId, investigationId, item) {
	const sql = await getSql();
	const label = item.label.slice(0, 240);
	if (!label) return;
	const existing = await sql`
    select id, queries_tried from frontier_items
    where investigation_id = ${investigationId} and user_id = ${userId} and label = ${label}
    limit 1
  `;
	if (existing[0]) {
		if (item.query) {
			const tried = parseJsonArray(existing[0].queries_tried);
			if (!tried.includes(item.query)) {
				tried.push(item.query);
				await sql`
          update frontier_items
          set queries_tried = ${JSON.stringify(tried).slice(0, 4e3)}
          where id = ${existing[0].id}
        `;
			}
		}
		return;
	}
	const budget = strategiesForFrontier(item.kind, label);
	const next = [...item.query ? [item.query] : [], ...budget.map((s) => s.query)].filter((q, i, arr) => q && arr.indexOf(q) === i).join(" | ").slice(0, 800);
	await sql`
    insert into frontier_items (
      user_id, investigation_id, kind, label, why, evidence, priority, next_steps, queries_tried,
      strategies_tried, strategies_budget, search_zero_count
    ) values (
      ${userId}, ${investigationId}, ${item.kind.slice(0, 40)}, ${label},
      ${item.why.slice(0, 800)}, ${(item.evidence ?? "").slice(0, 400)},
      ${item.priority ?? 7}, ${next},
      ${JSON.stringify(item.query ? [item.query] : [])},
      ${JSON.stringify([])},
      ${JSON.stringify(budget.map((s) => s.key))},
      ${0}
    )
  `;
}
async function markFrontier(userId, investigationId, label, status, reason) {
	await (await getSql())`
    update frontier_items
    set status = ${status}, closed_reason = ${reason.slice(0, 800)}
    where investigation_id = ${investigationId} and user_id = ${userId}
      and label = ${label.slice(0, 240)} and status in ('open', 'investigating', 'reopened')
  `;
}
async function recordStrategyTried(userId, investigationId, label, strategyKey, query, zero) {
	const sql = await getSql();
	const row = (await sql`
    select id, strategies_tried, strategies_budget, search_zero_count, kind, queries_tried
    from frontier_items
    where investigation_id = ${investigationId} and user_id = ${userId} and label = ${label.slice(0, 240)}
    limit 1
  `)[0];
	if (!row) return {
		remaining: remainingStrategies("unknown", label, []),
		exhausted: false
	};
	const tried = parseJsonArray(row.strategies_tried);
	if (strategyKey && !tried.includes(strategyKey) && strategyKey !== "adhoc") tried.push(strategyKey);
	const queries = parseJsonArray(row.queries_tried);
	if (query && !queries.includes(query)) queries.push(query);
	const budget = parseJsonArray(row.strategies_budget);
	const remaining = remainingStrategies(row.kind, label, tried.length ? tried : budget.length ? tried : []);
	const zeroCount = (row.search_zero_count ?? 0) + (zero ? 1 : 0);
	await sql`
    update frontier_items
    set strategies_tried = ${JSON.stringify(tried)},
        queries_tried = ${JSON.stringify(queries).slice(0, 4e3)},
        search_zero_count = ${zeroCount},
        next_steps = ${remaining.map((s) => s.query).join(" | ").slice(0, 800)}
    where id = ${row.id}
  `;
	return {
		remaining,
		exhausted: row.kind !== "url" && remaining.length === 0 && (tried.length > 0 || budget.length > 0) && zero
	};
}
async function rememberCapture(opts) {
	const sql = await getSql();
	let url = opts.url;
	try {
		url = canonicalPublicUrl(opts.url);
	} catch {}
	const fullText = (opts.text ?? "").slice(0, ARCHIVE_TEXT_CAP);
	const existing = await sql`
    select id from artifact_versions
    where user_id = ${opts.userId} and url = ${url} and content_hash = ${opts.hash}
    limit 1
  `;
	let versionId = existing[0]?.id ?? null;
	let createdVersion = false;
	if (!versionId) try {
		versionId = (await sql`
        insert into artifact_versions (
          user_id, url, content_hash, title, full_text, fetch_status, fetch_outcome,
          content_type, extraction_method, page_count
        ) values (
          ${opts.userId}, ${url}, ${opts.hash}, ${opts.title.slice(0, 200)},
          ${fullText}, ${opts.status}, ${opts.outcome},
          ${opts.contentType ?? "html"}, ${opts.extractionMethod ?? ""},
          ${opts.pages?.length ?? null}
        )
        on conflict (user_id, url, content_hash) do update set title = excluded.title
        returning id
      `)[0]?.id ?? null;
		createdVersion = Boolean(versionId) && !existing[0];
	} catch {
		versionId = (await sql`
        select id from artifact_versions
        where user_id = ${opts.userId} and url = ${url} and content_hash = ${opts.hash}
        limit 1
      `)[0]?.id ?? null;
		if (!versionId) {
			versionId = (await sql`
          insert into artifact_versions (
            user_id, url, content_hash, title, full_text, fetch_status, fetch_outcome
          ) values (
            ${opts.userId}, ${url}, ${opts.hash}, ${opts.title.slice(0, 200)},
            ${fullText}, ${opts.status}, ${opts.outcome}
          )
          returning id
        `)[0]?.id ?? null;
			createdVersion = Boolean(versionId);
		}
	}
	if (versionId && (createdVersion || !existing[0]) && fullText) {
		if (((await sql`
      select count(*)::int as c from artifact_chunks where version_id = ${versionId} and user_id = ${opts.userId}
    `)[0]?.c ?? 0) === 0) {
			const chunks = chunksFromEvidence(fullText, opts.pages);
			for (const c of chunks) await sql`
          insert into artifact_chunks (version_id, user_id, chunk_index, page_number, section, excerpt, locator)
          values (
            ${versionId}, ${opts.userId}, ${c.index}, ${c.page_number},
            ${c.section}, ${c.excerpt}, ${c.locator}
          )
        `;
		}
	}
	const disappearance = opts.outcome === "removed" || opts.outcome === "not-found";
	const soft404 = opts.outcome === "soft-404" || opts.outcome === "removed";
	const observed = (opts.observedAt ?? /* @__PURE__ */ new Date()).toISOString();
	const captureEventId = (await sql`
    insert into capture_events (
      user_id, investigation_id, source_url, observed_at, http_status, fetch_outcome,
      redirect_chain, version_id, disappearance, soft_404, trigger_kind, monitor_id,
      content_hash, content_type, extraction_method
    ) values (
      ${opts.userId}, ${opts.investigationId}, ${url}, ${observed}::timestamptz,
      ${opts.status}, ${opts.outcome}, ${JSON.stringify(opts.redirectChain ?? [])},
      ${versionId}, ${disappearance}, ${soft404}, ${opts.triggerKind ?? "investigation"},
      ${opts.monitorId ?? null}, ${opts.hash}, ${opts.contentType ?? ""},
      ${opts.extractionMethod ?? ""}
    )
    returning id
  `)[0].id;
	if (opts.investigationId != null) await sql`
      insert into artifacts (
        user_id, investigation_id, url, title, content_hash, full_text,
        classification, fetch_status, fetch_outcome, version_id, capture_event_id, extraction_method
      ) values (
        ${opts.userId}, ${opts.investigationId}, ${url}, ${opts.title.slice(0, 200)},
        ${opts.hash}, ${fullText}, ${opts.classification ?? "discovered"},
        ${opts.status}, ${opts.outcome}, ${versionId}, ${captureEventId},
        ${opts.extractionMethod ?? ""}
      )
    `;
	if (opts.outcome === "fetched" || opts.outcome === "changed" || opts.outcome === "unchanged") await maybeWatch(opts.userId, url, opts.title, opts.investigationId, versionId, opts.extras ?? []);
	return {
		versionId,
		captureEventId,
		contentHash: opts.hash,
		url
	};
}
async function maybeWatch(userId, url, title, investigationId, versionId, extras) {
	const spec = baselineSpec(url, title);
	if (!spec) return;
	const sql = await getSql();
	const cadenceHours = spec.kind === "meeting" ? 24 : spec.kind === "report" ? 48 : 72;
	const structure = JSON.stringify(structureSnapshot(title, "", extras));
	const existing = await sql`
    select id from source_monitors where user_id = ${userId} and url = ${url} limit 1
  `;
	const next = new Date(Date.now() + cadenceHours * 3600 * 1e3).toISOString();
	if (existing[0]) {
		await sql`
      update source_monitors
      set title = ${title.slice(0, 200)}, last_version_id = ${versionId},
          last_success_at = now(), last_outcome = ${"fetched"},
          typical_structure = ${structure},
          investigation_id = coalesce(investigation_id, ${investigationId})
      where id = ${existing[0].id}
    `;
		return;
	}
	await sql`
    insert into source_monitors (
      user_id, url, title, enabled, cadence_hours, next_check_at, last_success_at,
      last_outcome, last_version_id, expected_cadence_days, importance,
      disappearance_sensitive, investigation_id, typical_structure
    ) values (
      ${userId}, ${url}, ${title.slice(0, 200)}, ${true}, ${cadenceHours},
      ${next}::timestamptz, now(), ${"fetched"},
      ${versionId}, ${Math.round(cadenceHours / 24)}, ${8}, ${true},
      ${investigationId}, ${structure}
    )
    on conflict (user_id, url) do update set last_success_at = now()
  `;
}
function baselineSpec(url, title) {
	const blob = `${url} ${title}`.toLowerCase();
	let kind = "";
	if (/agenda|minutes|city.?council|board.?meeting/.test(blob)) kind = "meeting";
	else if (/(water|utility|wastewater|drinking).{0,40}(report|quality)/.test(blob)) kind = "report";
	else if (/budget|cafr|financial.?report/.test(blob)) kind = "report";
	else if (/staff.?report|packet/.test(blob)) kind = "packet";
	else if (/procurement|purchasing|bid|rfp/.test(blob)) kind = "report";
	else if (/dashboard|dataset|filing|disclosure/.test(blob)) kind = "report";
	else return null;
	let path = url;
	try {
		const u = new URL(url);
		path = u.origin + u.pathname;
	} catch {}
	return {
		key: `${kind}:${path.replace(/\/\d{4}([/-]\d{1,2}){0,2}/g, "").replace(/\/\d{4,8}\b/g, "").slice(0, 200)}`,
		kind
	};
}
async function observeBaseline(userId, url, title, at, extras = []) {
	const spec = baselineSpec(url, title);
	if (!spec) return;
	const sql = await getSql();
	const prev = await sql`
    select last_seen::text as last_seen, sightings, cadence_days, usual_nth_weekday,
           usual_attachment_count, usual_lead_hours, typical_structure_json
    from recurring_baselines where user_id = ${userId} and key = ${spec.key} limit 1
  `;
	const now = at ?? /* @__PURE__ */ new Date();
	let cadence = prev[0]?.cadence_days ?? 30;
	const sightings = (prev[0]?.sightings ?? 0) + 1;
	if (prev[0]?.last_seen) {
		const gap = (now.getTime() - new Date(prev[0].last_seen).getTime()) / 864e5;
		if (gap > 3 && gap < 400) cadence = Math.round(((prev[0].cadence_days || 30) + gap) / 2);
	}
	const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
	const nth = nthWeekday(now);
	const snap = structureSnapshot(title, "", extras);
	const meeting = extractMeetingInstant(title);
	let lead = prev[0]?.usual_lead_hours ?? null;
	if (meeting) {
		const hours = leadHoursBefore(now, meeting);
		if (hours != null) lead = lead != null ? Math.round((lead + hours) / 2) : hours;
	}
	const seen = now.toISOString();
	if (prev[0]) await sql`
      update recurring_baselines
      set last_seen = ${seen}::timestamptz, typical_title = ${title.slice(0, 200)}, typical_url = ${url.slice(0, 500)},
          cadence_days = ${cadence}, sightings = ${sightings}, usual_weekday = ${weekday},
          usual_nth_weekday = ${nth}, usual_attachment_count = ${snap.attachmentCount},
          usual_lead_hours = ${lead}, typical_structure_json = ${JSON.stringify(snap)}
      where user_id = ${userId} and key = ${spec.key}
    `;
	else await sql`
      insert into recurring_baselines (
        user_id, key, kind, cadence_days, last_seen, typical_title, typical_url, sightings,
        usual_weekday, usual_nth_weekday, usual_attachment_count, usual_lead_hours, typical_structure_json
      ) values (
        ${userId}, ${spec.key}, ${spec.kind}, ${cadence}, ${seen}::timestamptz,
        ${title.slice(0, 200)}, ${url.slice(0, 500)}, ${1}, ${weekday}, ${nth},
        ${snap.attachmentCount}, ${lead}, ${JSON.stringify(snap)}
      )
      on conflict (user_id, key) do update set last_seen = excluded.last_seen, sightings = recurring_baselines.sightings + 1
    `;
}
async function flagPatternAnomalies(opts) {
	const sql = await getSql();
	const spec = baselineSpec(opts.url, opts.title);
	let usualNth = null;
	let usualAtt = null;
	let usualLead = null;
	if (spec) {
		const b = await sql`
      select usual_nth_weekday, usual_attachment_count, usual_lead_hours
      from recurring_baselines where user_id = ${opts.userId} and key = ${spec.key} limit 1
    `;
		usualNth = b[0]?.usual_nth_weekday ?? null;
		usualAtt = b[0]?.usual_attachment_count ?? null;
		usualLead = b[0]?.usual_lead_hours ?? null;
	}
	const meeting = extractMeetingInstant(`${opts.title}\n${opts.text.slice(0, 4e3)}`);
	const currentLead = meeting ? leadHoursBefore(opts.now, meeting) : null;
	const current = structureSnapshot(opts.title, opts.text, opts.extras);
	const found = detectPatternAnomalies({
		previous: opts.previous,
		current,
		usualNthWeekday: usualNth,
		observedAt: opts.now,
		usualAttachmentCount: usualAtt,
		usualLeadHours: usualLead,
		currentLeadHours: currentLead
	});
	for (const a of found) await sql`
      insert into anomalies (user_id, investigation_id, kind, summary, url, details)
      values (
        ${opts.userId}, ${opts.investigationId}, ${a.kind}, ${a.summary.slice(0, 1e3)},
        ${opts.url}, ${a.details.slice(0, 2e3)}
      )
    `;
	return found.length;
}
async function retrievePack(userId, investigationId, terms) {
	const sql = await getSql();
	const seeds = await sql`
    select url, title, full_text from artifacts
    where investigation_id = ${investigationId} and user_id = ${userId} and classification = 'watch'
    order by id asc limit 3
  `;
	const recent = await sql`
    select url, title, full_text, version_id, capture_event_id, content_hash from artifacts
    where investigation_id = ${investigationId} and user_id = ${userId}
    order by id desc limit 40
  `;
	const lowered = terms.map((t) => t.toLowerCase()).filter((t) => t.length > 3);
	const scored = recent.map((a) => {
		const blob = `${a.title} ${a.url} ${a.full_text}`.toLowerCase();
		const score = lowered.reduce((s, t) => s + (blob.includes(t) ? 2 : 0), 0);
		return {
			...a,
			score
		};
	}).sort((a, b) => b.score - a.score);
	const picked = [...seeds, ...scored.filter((a) => !seeds.some((s) => s.url === a.url)).slice(0, 8)];
	const matchedChunks = (lowered.length > 0 ? await sql`
          select c.excerpt, c.page_number, c.locator, c.version_id, av.url
          from artifact_chunks c
          join artifact_versions av on av.id = c.version_id
          where av.user_id = ${userId}
            and exists (
              select 1 from artifacts a
              where a.version_id = av.id and a.investigation_id = ${investigationId} and a.user_id = ${userId}
            )
          order by c.id desc
          limit 80
        ` : []).filter((c) => lowered.some((t) => c.excerpt.toLowerCase().includes(t))).slice(0, 8);
	const frontier = await sql`
    select label, kind, why, priority, next_steps, status from frontier_items
    where investigation_id = ${investigationId} and user_id = ${userId}
    order by priority desc, id asc limit 16
  `;
	const hyps = await sql`
    select body, status, supporting, contradicting from hypotheses
    where investigation_id = ${investigationId} and user_id = ${userId}
    order by id desc limit 12
  `;
	const ents = await sql`
    select e.name, e.kind, e.why, e.canonical
    from investigation_entities ie
    join entities e on e.id = ie.entity_id
    where ie.investigation_id = ${investigationId} and ie.user_id = ${userId}
    order by ie.id desc limit 20
  `;
	const historical = await sql`
    select e.name, e.kind, e.why, ie.investigation_id, m.verdict
    from entities e
    join investigation_entities ie on ie.entity_id = e.id
    left join entity_matches m on m.user_id = ${userId}
      and (
        (m.left_canonical = e.canonical and m.right_canonical in (
          select e2.canonical from investigation_entities x
          join entities e2 on e2.id = x.entity_id
          where x.investigation_id = ${investigationId} and x.user_id = ${userId}
        ))
        or (m.right_canonical = e.canonical and m.left_canonical in (
          select e2.canonical from investigation_entities x
          join entities e2 on e2.id = x.entity_id
          where x.investigation_id = ${investigationId} and x.user_id = ${userId}
        ))
      )
    where e.user_id = ${userId}
      and ie.investigation_id <> ${investigationId}
      and (
        e.canonical in (
          select e2.canonical from investigation_entities x
          join entities e2 on e2.id = x.entity_id
          where x.investigation_id = ${investigationId} and x.user_id = ${userId}
        )
        or m.id is not null
      )
    order by ie.id desc
    limit 8
  `;
	const rels = await sql`
    select from_name, to_name, kind, evidence from relationships
    where investigation_id = ${investigationId} and user_id = ${userId} limit 16
  `;
	const claims = await sql`
    select body, kind, evidence from claims
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 12
  `;
	const anoms = await sql`
    select kind, summary from anomalies
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 10
  `;
	const dead = await sql`
    select hypothesis, dismissed_because from dead_ends
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 8
  `;
	const searches = await sql`
    select query, state from search_log
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 24
  `;
	return [
		`FRONTIER:\n${frontier.map((f) => `${f.status} ${f.priority} ${f.kind}: ${f.label} — ${f.why}`).join("\n") || "(empty)"}`,
		`HYPOTHESES:\n${hyps.map((h) => `[${h.status}] ${h.body} pro:${h.supporting} con:${h.contradicting}`).join("\n") || "(none)"}`,
		`ENTITIES (this investigation):\n${ents.map((e) => `${e.kind}: ${e.name} — ${e.why}`).join("\n") || "(none)"}`,
		`HISTORICAL MATCHES (other investigations, labeled):\n${historical.map((e) => `[from inv ${e.investigation_id}${e.verdict ? ` ${e.verdict}` : ""}] ${e.kind}: ${e.name} — ${e.why}`).join("\n") || "(none)"}`,
		`RELATIONSHIPS:\n${rels.map((r) => `${r.from_name} -[${r.kind}]-> ${r.to_name}`).join("\n") || "(none)"}`,
		`CLAIMS:\n${claims.map((c) => `${c.kind}: ${c.body}`).join("\n") || "(none)"}`,
		`ANOMALIES:\n${anoms.map((a) => `${a.kind}: ${a.summary}`).join("\n") || "(none)"}`,
		`DEAD ENDS:\n${dead.map((d) => `${d.hypothesis} — ${d.dismissed_because}`).join("\n") || "(none)"}`,
		`SEARCHES:\n${searches.map((s) => `${s.state ?? "unknown"} ${s.query}`).join("\n") || "(none)"}`,
		`RELEVANT ARTIFACTS:\n${picked.map((a) => {
			const rec = a;
			return `### [capture:${rec.capture_event_id ?? "—"} version:${rec.version_id ?? "—"} hash:${(rec.content_hash ?? "").slice(0, 12)}] ${a.title}\n${a.url}\n${a.full_text.slice(0, 1800)}`;
		}).join("\n\n") || "(none)"}`,
		`CHUNK HITS:\n${matchedChunks.map((c) => `[version:${c.version_id} page:${c.page_number ?? "—"} ${c.locator}] ${c.excerpt.slice(0, 500)}`).join("\n") || "(none)"}`
	].join("\n\n");
}
async function researchLoop(opts) {
	const sql = await getSql();
	const hopsBudget = opts.hops ?? 5;
	const fetchDoc = opts.fetch ?? defaultFetch;
	const planner = opts.planner;
	const tried = /* @__PURE__ */ new Set();
	const priorQueries = await sql`
    select query from search_log where investigation_id = ${opts.investigationId} and user_id = ${opts.userId}
  `;
	for (const q of priorQueries) tried.add(queryFingerprint(q.query));
	let hopsDone = 0;
	let lastSummary = "";
	const fetchedThisRun = /* @__PURE__ */ new Set();
	function canon(raw) {
		try {
			return canonicalPublicUrl(raw);
		} catch {
			return raw;
		}
	}
	async function runSearch(q) {
		if (opts.searchAttempt) return opts.searchAttempt(q);
		if (opts.search) try {
			const hits = await opts.search(q);
			return {
				state: hits.length ? "SEARCH_SUCCESS_RESULTS" : "SEARCH_SUCCESS_ZERO_RESULTS",
				hits,
				provider: "injected"
			};
		} catch (err) {
			return {
				state: "SEARCH_FAILED_NETWORK",
				hits: [],
				provider: "injected",
				error: err instanceof Error ? err.message : "search failed"
			};
		}
		return searchWithFallback(q);
	}
	for (let hop = 0; hop < hopsBudget; hop++) {
		const openFrontier = await sql`
      select id, label, kind, next_steps, strategies_tried from frontier_items
      where investigation_id = ${opts.investigationId} and user_id = ${opts.userId}
        and status in ('open', 'investigating', 'reopened')
      order by priority desc limit 16
    `;
		const terms = openFrontier.map((f) => f.label);
		const graph = await retrievePack(opts.userId, opts.investigationId, terms);
		const pack = [
			`INVESTIGATION ${opts.investigationId}. Hop ${hop + 1}. Longmont, Colorado.`,
			graph,
			`QUERIES ALREADY TRIED:\n${[...tried].slice(-40).join("\n") || "(none)"}`,
			`Generate the NEXT searches and fetches. Follow names, companies, contracts, parcels. Search contradictions. A failed search is not "nothing found." Do not stop after one hop. Cite capture and version IDs from artifacts when making claims.`
		].join("\n\n");
		let plan;
		if (planner) plan = await planner(pack);
		else {
			const grok = await grokPlanner(pack);
			const heur = heuristicPlan(graph, tried);
			plan = grok.searches.length || grok.fetch_urls.length ? grok : heur;
			if (!plan.searches.length && heur.searches.length) plan.searches = heur.searches;
			if (!plan.fetch_urls.length && heur.fetch_urls.length) plan.fetch_urls = heur.fetch_urls;
			plan.frontier = [...plan.frontier, ...heur.frontier];
		}
		lastSummary = plan.summary;
		for (const url of plan.fetch_urls) await persistDiscovery(opts.userId, opts.investigationId, {
			kind: "url",
			label: url,
			why: "Planner fetch target",
			evidence: url,
			priority: 10
		});
		for (const f of plan.frontier) await persistDiscovery(opts.userId, opts.investigationId, {
			kind: f.kind,
			label: f.label,
			why: f.why,
			priority: f.priority,
			query: (f.queries ?? [])[0]
		});
		const fromFrontier = [];
		const toFetch = new Set(plan.fetch_urls);
		for (const f of openFrontier) {
			if (f.kind === "url" && /^https?:/i.test(f.label)) {
				toFetch.add(f.label);
				continue;
			}
			let added = 0;
			for (const q of (f.next_steps || "").split("|").map((s) => s.trim()).filter(Boolean)) {
				if (q.startsWith("http://") || q.startsWith("https://")) {
					toFetch.add(q);
					continue;
				}
				if (q && !tried.has(queryFingerprint(q)) && added < 1) {
					fromFrontier.push(q);
					added += 1;
				}
			}
		}
		const planned = [...plan.searches, ...fromFrontier].filter((q, i, arr) => q && !tried.has(queryFingerprint(q)) && arr.findIndex((x) => queryFingerprint(x) === queryFingerprint(q)) === i);
		const fill = [];
		for (const f of openFrontier) {
			if (planned.length + fill.length >= 3) break;
			if (f.kind === "url") continue;
			const triedStrats = parseJsonArray(f.strategies_tried);
			for (const s of remainingStrategies(f.kind, f.label, triedStrats)) {
				if (planned.length + fill.length >= 3) break;
				const q = s.query;
				if (!q || q.startsWith("http://") || q.startsWith("https://") || tried.has(queryFingerprint(q)) || planned.some((p) => queryFingerprint(p) === queryFingerprint(q)) || fill.some((p) => queryFingerprint(p) === queryFingerprint(q))) continue;
				fill.push(q);
			}
		}
		const queries = [...planned, ...fill].slice(0, 3);
		const selectedThisHop = [];
		const fetchedThisHop = [];
		const thisHopEvidenceNames = [];
		for (const q of queries) {
			tried.add(queryFingerprint(q));
			const attempt = await runSearch(q);
			const selected = attempt.hits.slice(0, 6).map((h) => h.url);
			selectedThisHop.push(...selected);
			const fp = queryFingerprint(q);
			const matchedFrontier = openFrontier.find((f) => q.toLowerCase().includes(f.label.toLowerCase().slice(0, 24)) || strategyKeyForQuery(f.kind, f.label, q) !== "adhoc");
			const strategy = matchedFrontier ? strategyKeyForQuery(matchedFrontier.kind, matchedFrontier.label, q) : "adhoc";
			const logId = (await sql`
        insert into search_log (
          user_id, investigation_id, hop, query, results_json, provider, state, caused_by,
          frontier_id, strategy, selected_json, query_fingerprint, research_question
        )
        values (
          ${opts.userId}, ${opts.investigationId}, ${hop + 1}, ${q.slice(0, 300)},
          ${JSON.stringify(attempt.hits).slice(0, 8e3)},
          ${attempt.provider}, ${attempt.state}, ${plan.summary.slice(0, 200)},
          ${matchedFrontier?.id ?? null}, ${strategy},
          ${JSON.stringify(selected).slice(0, 4e3)}, ${fp}, ${plan.questions[0] ?? plan.summary.slice(0, 200)}
        )
        returning id
      `)[0]?.id ?? null;
			const lineage = attempt.lineage?.length ? attempt.lineage : [attempt];
			for (const step of lineage) await sql`
          insert into search_attempts (
            user_id, investigation_id, search_log_id, frontier_id, query, provider, state, hits_json, error
          ) values (
            ${opts.userId}, ${opts.investigationId}, ${logId}, ${matchedFrontier?.id ?? null},
            ${q.slice(0, 300)}, ${step.provider}, ${step.state},
            ${JSON.stringify(step.hits).slice(0, 8e3)}, ${step.error ?? null}
          )
        `;
			if (attempt.state !== "SEARCH_SUCCESS_RESULTS" && attempt.state !== "SEARCH_SUCCESS_ZERO_RESULTS") await sql`
          insert into anomalies (user_id, investigation_id, kind, summary, details)
          values (
            ${opts.userId}, ${opts.investigationId}, ${"search-failed"},
            ${`Search ${attempt.state} via ${attempt.provider}: ${q.slice(0, 180)}`},
            ${attempt.error ?? attempt.state}
          )
        `;
			for (const hit of attempt.hits.slice(0, 6)) {
				toFetch.add(hit.url);
				await persistDiscovery(opts.userId, opts.investigationId, {
					kind: "url",
					label: hit.url,
					why: `Search hit for ${q}`,
					evidence: hit.title,
					priority: 9,
					query: q
				});
			}
			for (const f of openFrontier) if (q.toLowerCase().includes(f.label.toLowerCase().slice(0, 24)) || strategyKeyForQuery(f.kind, f.label, q) !== "adhoc") {
				await sql`
            update frontier_items set status = 'investigating'
            where investigation_id = ${opts.investigationId} and user_id = ${opts.userId}
              and label = ${f.label} and status = 'open'
          `;
				await persistDiscovery(opts.userId, opts.investigationId, {
					kind: f.kind,
					label: f.label,
					why: "query attempted",
					query: q
				});
				if (attempt.state === "SEARCH_SUCCESS_ZERO_RESULTS") {
					if ((await recordStrategyTried(opts.userId, opts.investigationId, f.label, strategyKeyForQuery(f.kind, f.label, q), q, true)).exhausted) await markFrontier(opts.userId, opts.investigationId, f.label, "exhausted", `All research strategies attempted; last zero for ${q}`);
				} else if (attempt.state === "SEARCH_SUCCESS_RESULTS") await recordStrategyTried(opts.userId, opts.investigationId, f.label, strategyKeyForQuery(f.kind, f.label, q), q, false);
			}
		}
		while (fetchedThisHop.length < 4) {
			const url = [...new Set(sanitizePublicUrls([...toFetch]).map(canon).filter((u) => !fetchedThisRun.has(u)))][0];
			if (!url) break;
			fetchedThisRun.add(url);
			fetchedThisHop.push(url);
			await persistDiscovery(opts.userId, opts.investigationId, {
				kind: "url",
				label: url,
				why: "Queued for fetch",
				evidence: url,
				priority: 10
			});
			const prior = (await sql`
        select ce.content_hash, ce.http_status as fetch_status, av.full_text
        from capture_events ce
        left join artifact_versions av on av.id = ce.version_id
        where ce.user_id = ${opts.userId} and ce.source_url = ${url}
        order by ce.id desc limit 1
      `)[0] ?? (await sql`
            select content_hash, full_text, fetch_status from artifact_versions
            where user_id = ${opts.userId} and url = ${url}
            order by id desc limit 1
          `)[0];
			const got = await fetchDoc(url);
			const hash = got.ok ? await sha256(got.text) : "missing";
			const classified = classifyFetchedPage({
				status: got.status,
				title: got.title,
				text: got.text,
				priorHash: prior?.content_hash,
				priorStatus: prior?.fetch_status,
				newHash: hash
			});
			const outcome = got.outcome === "needs-ocr" ? "needs-ocr" : classified;
			await rememberCapture({
				userId: opts.userId,
				investigationId: opts.investigationId,
				url,
				title: got.title || url,
				text: got.text,
				hash,
				status: got.status,
				outcome,
				redirectChain: got.redirectChain,
				contentType: got.contentType,
				extractionMethod: got.extractionMethod,
				pages: got.pages,
				extras: got.extras
			});
			if (outcome === "unchanged") {
				await markFrontier(opts.userId, opts.investigationId, url, "resolved", "Unchanged capture");
				continue;
			}
			if (outcome === "removed" || outcome === "not-found" || outcome === "soft-404") {
				if (prior && prior.fetch_status === 200) {
					await sql`
            insert into anomalies (user_id, investigation_id, kind, summary, url, details)
            values (
              ${opts.userId}, ${opts.investigationId}, ${"disappeared"},
              ${`Previously captured document is gone: ${url}`},
              ${url},
              ${`Prior hash ${prior.content_hash}. Outcome ${outcome}. Status ${got.status}. Original version retained.`}
            )
          `;
					const follow = [`"${url}" (wayback OR archive.org OR relocated OR moved)`, `${(got.title || "document").slice(0, 80)} Longmont (replacement OR "no longer" OR cancelled)`];
					for (const q of follow) await persistDiscovery(opts.userId, opts.investigationId, {
						kind: "missing-record",
						label: q.slice(0, 240),
						why: `Follow-up after ${outcome} of ${url}`,
						evidence: url,
						priority: 12,
						query: q
					});
					try {
						const copies = opts.archives ? await opts.archives(url) : await waybackCopies(url);
						for (const c of copies.slice(0, 3)) {
							toFetch.add(c);
							await persistDiscovery(opts.userId, opts.investigationId, {
								kind: "url",
								label: c,
								why: `Archive copy after disappearance of ${url}`,
								evidence: url,
								priority: 12
							});
						}
					} catch {}
				}
				await markFrontier(opts.userId, opts.investigationId, url, "exhausted", outcome);
				continue;
			}
			if (!got.ok) {
				await markFrontier(opts.userId, opts.investigationId, url, "deferred", `Fetch ${outcome}`);
				continue;
			}
			if (outcome === "changed" && prior?.full_text) {
				const delta = diffExcerpt(prior.full_text, got.text);
				if (delta) await sql`
            insert into anomalies (user_id, investigation_id, kind, summary, url, details)
            values (
              ${opts.userId}, ${opts.investigationId}, ${"changed"},
              ${`Document changed: ${url}`}, ${url}, ${delta.slice(0, 4e3)}
            )
          `;
				let prevSnap = null;
				try {
					const mon = await sql`
            select typical_structure from source_monitors where user_id = ${opts.userId} and url = ${url} limit 1
          `;
					if (mon[0]?.typical_structure) prevSnap = JSON.parse(mon[0].typical_structure);
				} catch {
					prevSnap = null;
				}
				await flagPatternAnomalies({
					userId: opts.userId,
					investigationId: opts.investigationId,
					url,
					title: got.title || url,
					text: got.text,
					extras: got.extras,
					previous: prevSnap,
					now: /* @__PURE__ */ new Date()
				});
			}
			await observeBaseline(opts.userId, url, got.title, void 0, got.extras);
			await markFrontier(opts.userId, opts.investigationId, url, "resolved", "Fetched");
			for (const extra of got.extras.slice(0, 6)) {
				toFetch.add(extra);
				await persistDiscovery(opts.userId, opts.investigationId, {
					kind: "url",
					label: extra,
					why: `Attachment/document link on ${url}`,
					evidence: url,
					priority: 11
				});
			}
			const refs = extractReferences(got.text);
			await addFrontierFromRefs(opts.userId, opts.investigationId, refs, url);
			for (const ref of refs) thisHopEvidenceNames.push(ref.value);
			if (got.title) thisHopEvidenceNames.push(got.title);
		}
		for (const extra of sanitizePublicUrls([...toFetch])) {
			const leftover = canon(extra);
			if (fetchedThisRun.has(leftover)) continue;
			await persistDiscovery(opts.userId, opts.investigationId, {
				kind: "url",
				label: leftover,
				why: "Discovered this hop — fetch next",
				evidence: leftover,
				priority: 10
			});
		}
		await persistPlan(opts.userId, opts.investigationId, plan);
		await resurfaceDeadEnds(opts.userId, opts.investigationId, thisHopEvidenceNames);
		if (queries.length) await sql`
        update search_log
        set fetched_json = ${JSON.stringify(fetchedThisHop).slice(0, 4e3)},
            generated_json = ${JSON.stringify({
			entities: plan.entities.map((e) => e.name),
			urls: plan.fetch_urls,
			questions: plan.questions
		}).slice(0, 4e3)}
        where investigation_id = ${opts.investigationId} and user_id = ${opts.userId} and hop = ${hop + 1}
      `;
		hopsDone += 1;
		await sql`
      update investigations
      set hops = hops + 1, summary = ${lastSummary.slice(0, 2500)}, updated_at = now()
      where id = ${opts.investigationId} and user_id = ${opts.userId}
    `;
		const open = await sql`
      select count(*)::int as c from frontier_items
      where investigation_id = ${opts.investigationId} and user_id = ${opts.userId}
        and status in ('open', 'investigating', 'reopened')
    `;
		if (plan.stop && (open[0]?.c ?? 0) === 0) break;
	}
	const open = await sql`
    select count(*)::int as c from frontier_items
    where investigation_id = ${opts.investigationId} and user_id = ${opts.userId}
      and status in ('open', 'investigating', 'reopened')
  `;
	const artsN = await sql`
    select count(*)::int as c from artifacts
    where investigation_id = ${opts.investigationId} and user_id = ${opts.userId}
  `;
	const paused = (open[0]?.c ?? 0) > 0;
	await sql`
    update investigations
    set status = ${paused ? "paused" : "open"}, updated_at = now()
    where id = ${opts.investigationId} and user_id = ${opts.userId}
  `;
	return {
		hops: hopsDone,
		artifacts: artsN[0]?.c ?? 0,
		frontier: open[0]?.c ?? 0,
		paused,
		summary: lastSummary
	};
}
async function resolveProvenance(userId, investigationId, hint) {
	const sql = await getSql();
	const unresolved = {
		versionId: null,
		captureEventId: null,
		sourceUrl: hint.source_url ?? null,
		contentHash: null,
		capturedAt: null,
		status: "unresolved",
		locator: hint.locator ?? null
	};
	if (hint.capture_event_id) {
		const row = await sql`
      select id, version_id, source_url, content_hash, observed_at::text as observed_at
      from capture_events
      where id = ${hint.capture_event_id} and user_id = ${userId}
      limit 1
    `;
		if (row[0]) return {
			versionId: row[0].version_id,
			captureEventId: row[0].id,
			sourceUrl: row[0].source_url,
			contentHash: row[0].content_hash,
			capturedAt: row[0].observed_at,
			status: "resolved",
			locator: hint.locator ?? null
		};
	}
	if (hint.artifact_version_id) {
		const row = await sql`
      select id, url, content_hash, captured_at::text as captured_at
      from artifact_versions
      where id = ${hint.artifact_version_id} and user_id = ${userId}
      limit 1
    `;
		if (row[0]) {
			const cap = await sql`
        select id, observed_at::text as observed_at from capture_events
        where version_id = ${row[0].id} and user_id = ${userId}
          and (investigation_id = ${investigationId} or investigation_id is null)
        order by id desc limit 1
      `;
			return {
				versionId: row[0].id,
				captureEventId: cap[0]?.id ?? null,
				sourceUrl: row[0].url,
				contentHash: row[0].content_hash,
				capturedAt: cap[0]?.observed_at ?? row[0].captured_at,
				status: "resolved",
				locator: hint.locator ?? null
			};
		}
	}
	if (hint.source_url) {
		let source = hint.source_url;
		try {
			source = canonicalPublicUrl(hint.source_url);
		} catch {}
		const cap = await sql`
      select id, version_id, source_url, content_hash, observed_at::text as observed_at
      from capture_events
      where user_id = ${userId} and investigation_id = ${investigationId} and source_url = ${source}
      order by id desc limit 1
    `;
		if (cap[0]) return {
			versionId: cap[0].version_id,
			captureEventId: cap[0].id,
			sourceUrl: cap[0].source_url,
			contentHash: cap[0].content_hash,
			capturedAt: cap[0].observed_at,
			status: "resolved",
			locator: hint.locator ?? null
		};
		const art = await sql`
      select version_id, capture_event_id, content_hash, url from artifacts
      where investigation_id = ${investigationId} and user_id = ${userId} and url = ${source}
      order by id desc limit 1
    `;
		if (art[0]?.version_id || art[0]?.capture_event_id) return {
			versionId: art[0].version_id,
			captureEventId: art[0].capture_event_id,
			sourceUrl: art[0].url,
			contentHash: art[0].content_hash,
			capturedAt: null,
			status: "resolved",
			locator: hint.locator ?? null
		};
	}
	return unresolved;
}
async function persistPlan(userId, investigationId, plan) {
	const sql = await getSql();
	const known = await sql`
    select canonical, name from entities where user_id = ${userId}
  `;
	for (const e of plan.entities) {
		const resolved = resolveEntityName(e.name, known);
		const key = identityKey(e.name);
		if (!key) continue;
		const merge = isConfirmedSame(resolved.verdict) && resolved.canonical === key;
		const c = merge ? resolved.canonical : key;
		let entityId = null;
		try {
			entityId = (await sql`
        insert into entities (user_id, canonical, name, kind, why)
        values (${userId}, ${c}, ${e.name.slice(0, 200)}, ${e.kind.slice(0, 40)}, ${e.why.slice(0, 800)})
        on conflict (user_id, canonical) do update set why = excluded.why
        returning id
      `)[0]?.id ?? null;
		} catch {
			try {
				entityId = (await sql`
          insert into entities (user_id, canonical, name, kind, why)
          values (${userId}, ${c}, ${e.name.slice(0, 200)}, ${e.kind.slice(0, 40)}, ${e.why.slice(0, 800)})
          returning id
        `)[0]?.id ?? null;
			} catch {
				await sql`
          update entities set why = ${e.why.slice(0, 800)}
          where user_id = ${userId} and canonical = ${c}
        `;
				entityId = (await sql`
          select id from entities where user_id = ${userId} and canonical = ${c} limit 1
        `)[0]?.id ?? null;
			}
		}
		if (entityId) {
			const hit = await sql`
        select version_id, capture_event_id, url from artifacts
        where investigation_id = ${investigationId} and user_id = ${userId}
          and (
            lower(full_text) like ${"%" + e.name.toLowerCase().slice(0, 80) + "%"}
            or lower(title) like ${"%" + e.name.toLowerCase().slice(0, 80) + "%"}
          )
        order by id desc limit 1
      `;
			try {
				await sql`
          insert into investigation_entities (
            user_id, investigation_id, entity_id, first_seen_version_id, first_seen_capture_id,
            first_seen_url, relevance, status
          ) values (
            ${userId}, ${investigationId}, ${entityId},
            ${hit[0]?.version_id ?? null}, ${hit[0]?.capture_event_id ?? null},
            ${hit[0]?.url ?? null}, ${"direct"}, ${"active"}
          )
          on conflict (investigation_id, entity_id) do nothing
        `;
			} catch {}
			if (hit[0]) await sql`
          update investigation_entities
          set first_seen_version_id = coalesce(first_seen_version_id, ${hit[0].version_id}),
              first_seen_capture_id = coalesce(first_seen_capture_id, ${hit[0].capture_event_id}),
              first_seen_url = coalesce(first_seen_url, ${hit[0].url})
          where investigation_id = ${investigationId} and entity_id = ${entityId}
            and user_id = ${userId} and first_seen_capture_id is null
        `;
		}
		if (!merge && resolved.matched && resolved.canonical !== c) {
			const verdict = resolved.verdict === "possible" ? "possible-same" : resolved.verdict === "same" ? "possible-same" : resolved.verdict;
			try {
				await sql`
          insert into entity_aliases (user_id, canonical, alias, verdict, evidence)
          values (${userId}, ${resolved.canonical}, ${e.name.slice(0, 200)}, ${verdict}, ${e.why.slice(0, 400)})
          on conflict (user_id, canonical, alias) do update set verdict = excluded.verdict
        `;
			} catch {}
			const [left, right] = [resolved.canonical, c].sort();
			try {
				await sql`
          insert into entity_matches (user_id, left_canonical, right_canonical, verdict, evidence, investigation_id)
          values (${userId}, ${left}, ${right}, ${verdict}, ${e.why.slice(0, 400)}, ${investigationId})
          on conflict (user_id, left_canonical, right_canonical) do update set verdict = excluded.verdict
        `;
			} catch {}
		}
		known.push({
			canonical: c,
			name: e.name
		});
	}
	for (const r of plan.relationships) {
		const prov = await resolveProvenance(userId, investigationId, {
			source_url: r.source_url,
			artifact_version_id: r.artifact_version_id,
			capture_event_id: r.capture_event_id,
			locator: r.locator,
			excerpt: r.evidence
		});
		await sql`
      insert into relationships (
        user_id, investigation_id, from_name, to_name, kind, evidence, source_url,
        version_id, excerpt, capture_event_id, capture_hash, provenance_status, locator
      )
      values (
        ${userId}, ${investigationId}, ${r.from.slice(0, 200)}, ${r.to.slice(0, 200)},
        ${r.kind.slice(0, 80)}, ${r.evidence.slice(0, 2e3)}, ${prov.sourceUrl},
        ${prov.versionId}, ${r.evidence.slice(0, 800)}, ${prov.captureEventId},
        ${prov.contentHash}, ${prov.status}, ${prov.locator}
      )
    `;
	}
	for (const h of plan.hypotheses) {
		const status = h.contradicting.trim() ? "weakened" : h.supporting.trim() ? "strengthened" : "active";
		const existing = await sql`
      select id from hypotheses
      where investigation_id = ${investigationId} and user_id = ${userId} and body = ${h.text.slice(0, 2e3)}
      limit 1
    `;
		if (existing[0]) await sql`
        update hypotheses
        set supporting = ${h.supporting.slice(0, 2e3)},
            contradicting = ${h.contradicting.slice(0, 2e3)},
            status = ${status},
            transition_note = ${`Evidence update (${status})`}
        where id = ${existing[0].id}
      `;
		else await sql`
        insert into hypotheses (user_id, investigation_id, body, supporting, contradicting, status, transition_note)
        values (
          ${userId}, ${investigationId}, ${h.text.slice(0, 2e3)},
          ${h.supporting.slice(0, 2e3)}, ${h.contradicting.slice(0, 2e3)},
          ${status}, ${"opened"}
        )
      `;
	}
	for (const c of plan.claims) {
		const conf = c.confidence;
		const prov = await resolveProvenance(userId, investigationId, {
			source_url: c.source_url,
			artifact_version_id: c.artifact_version_id,
			capture_event_id: c.capture_event_id,
			locator: c.locator,
			excerpt: c.evidence
		});
		await sql`
      insert into claims (
        user_id, investigation_id, body, kind, evidence, source_url, confidence,
        version_id, excerpt, capture_hash, capture_event_id, provenance_status, locator, captured_at
      )
      values (
        ${userId}, ${investigationId}, ${c.text.slice(0, 2e3)}, ${c.kind},
        ${c.evidence.slice(0, 2e3)}, ${prov.sourceUrl ?? c.source_url ?? null}, ${conf ?? null},
        ${prov.versionId}, ${c.evidence.slice(0, 800)}, ${prov.contentHash},
        ${prov.captureEventId}, ${prov.status}, ${prov.locator},
        ${prov.capturedAt}
      )
    `;
	}
	for (const f of plan.frontier) await persistDiscovery(userId, investigationId, {
		kind: f.kind,
		label: f.label,
		why: f.why,
		priority: f.priority,
		query: (f.queries ?? [])[0]
	});
	for (const a of plan.anomalies) await sql`
      insert into anomalies (user_id, investigation_id, kind, summary, url, details)
      values (
        ${userId}, ${investigationId}, ${a.kind.slice(0, 40)}, ${a.summary.slice(0, 1e3)},
        ${a.url ?? null}, ${""}
      )
    `;
	for (const d of plan.dead_ends) {
		const entNames = await sql`
      select e.name from investigation_entities ie
      join entities e on e.id = ie.entity_id
      where ie.investigation_id = ${investigationId} and ie.user_id = ${userId}
      limit 40
    `;
		const blob = [d.hypothesis, ...entNames.map((n) => n.name)].join(", ").slice(0, 2e3);
		await sql`
      insert into dead_ends (user_id, investigation_id, hypothesis, dismissed_because, entities)
      values (
        ${userId}, ${investigationId}, ${d.hypothesis.slice(0, 1e3)},
        ${d.reason.slice(0, 2e3)}, ${blob}
      )
    `;
		await markFrontier(userId, investigationId, d.hypothesis, "dead-end", d.reason);
		await sql`
      update hypotheses
      set status = 'dead-end', transition_note = ${d.reason.slice(0, 800)}
      where investigation_id = ${investigationId} and user_id = ${userId}
        and body = ${d.hypothesis.slice(0, 2e3)}
    `;
	}
}
async function matchDeadEnds(userId, names) {
	const rows = await (await getSql())`
    select id, hypothesis, dismissed_because, entities, investigation_id from dead_ends
    where user_id = ${userId} order by created_at desc limit 80
  `;
	const lower = names.map((n) => n.toLowerCase());
	return rows.filter((r) => {
		const blob = `${r.hypothesis} ${r.entities}`.toLowerCase();
		return lower.some((n) => n.length > 3 && blob.includes(n));
	});
}
/** Reopen a dead end when newly captured evidence names it. Does not auto-reopen from the same old entity list. */
async function resurfaceDeadEnds(userId, investigationId, names, opts = {}) {
	const hits = await matchDeadEnds(userId, names);
	if (!hits.length) return 0;
	const sql = await getSql();
	let n = 0;
	for (const h of hits) {
		if (opts.foreignOnly && h.investigation_id === investigationId) continue;
		const label = h.hypothesis.slice(0, 240);
		const existing = await sql`
      select id, status from frontier_items
      where user_id = ${userId} and investigation_id = ${investigationId} and label = ${label}
      limit 1
    `;
		if (existing[0]) {
			if (existing[0].status === "dead-end" || existing[0].status === "exhausted") {
				await sql`
          update frontier_items
          set status = ${"reopened"},
              closed_reason = ${"New evidence revived this dead end"},
              priority = greatest(priority, 11)
          where id = ${existing[0].id}
        `;
				n += 1;
			}
		} else {
			await persistDiscovery(userId, investigationId, {
				kind: "revived-dead-end",
				label,
				why: `Prior dead end revived: ${h.dismissed_because}`,
				evidence: names.join(", ").slice(0, 400),
				priority: 11
			});
			n += 1;
		}
		await sql`
      update hypotheses
      set status = ${"reopened"}, transition_note = ${"New evidence revived this dead end"}
      where user_id = ${userId} and investigation_id = ${investigationId}
        and status = ${"dead-end"} and body = ${h.hypothesis.slice(0, 2e3)}
    `;
	}
	return n;
}
async function checkBaselines(userId, investigationId, now = /* @__PURE__ */ new Date()) {
	const sql = await getSql();
	const rows = await sql`
    select key, typical_title, typical_url, cadence_days, last_seen::text as last_seen,
           usual_weekday, usual_nth_weekday, sightings
    from recurring_baselines where user_id = ${userId}
  `;
	let flagged = 0;
	for (const r of rows) {
		if (!r.last_seen) continue;
		const missing = detectMissingCadence([{
			key: r.key,
			at: new Date(r.last_seen),
			title: r.typical_title,
			url: r.typical_url
		}], now, r.cadence_days || 30, 7);
		for (const m of missing) {
			if ((await sql`
        select id from anomalies
        where user_id = ${userId} and investigation_id = ${investigationId}
          and kind = ${"missing-cadence"} and url is not distinct from ${m.url || null}
        limit 1
      `)[0]) {
				flagged += 1;
				continue;
			}
			const details = [
				`Last seen ${m.lastSeen.toISOString()}.`,
				`Learned cadence ${r.cadence_days} days.`,
				r.usual_weekday ? `Usual weekday ${r.usual_weekday}.` : "",
				r.usual_nth_weekday ? `Usual nth-weekday ${r.usual_nth_weekday}.` : "",
				r.sightings ? `${r.sightings} prior sightings.` : "",
				`Search for cancellation, reschedule, rename, archive.`
			].filter(Boolean).join(" ");
			await sql`
        insert into anomalies (user_id, investigation_id, kind, summary, url, details)
        values (
          ${userId}, ${investigationId}, ${"missing-cadence"},
          ${`Expected recurring record is late: ${m.title || m.key} (${m.daysLate} days past cadence)`},
          ${m.url || null},
          ${details}
        )
      `;
			const next = [
				`${m.title} cancellation`,
				`${m.title} rescheduled OR postponed`,
				`${m.title} agenda OR minutes OR notice`
			].join(" | ");
			await sql`
        insert into frontier_items (user_id, investigation_id, kind, label, why, priority, next_steps)
        values (
          ${userId}, ${investigationId}, ${"missing-record"}, ${m.title || m.key},
          ${"Dog that didn't bark — expected cadence broken"}, ${12},
          ${next.slice(0, 500)}
        )
      `;
			flagged += 1;
		}
	}
	return flagged;
}
async function runDueMonitors(opts) {
	const sql = await getSql();
	const now = opts.now ?? /* @__PURE__ */ new Date();
	const fetchDoc = opts.fetch ?? defaultFetch;
	const due = (await sql`
    select id, url, title, investigation_id, cadence_hours, last_version_id, typical_structure
    from source_monitors
    where user_id = ${opts.userId} and enabled = true and next_check_at <= ${now.toISOString()}::timestamptz
    order by next_check_at asc
  `).slice(0, opts.limit ?? 20);
	let anomalies = 0;
	for (const m of due) {
		let url = m.url;
		try {
			url = canonicalPublicUrl(m.url);
		} catch {}
		const priorCap = await sql`
      select ce.content_hash, ce.http_status as fetch_status, av.full_text, ce.fetch_outcome
      from capture_events ce
      left join artifact_versions av on av.id = ce.version_id
      where ce.user_id = ${opts.userId} and ce.source_url = ${url}
      order by ce.id desc limit 1
    `;
		const got = await fetchDoc(url);
		const hash = got.ok ? await sha256(got.text) : "missing";
		const classified = classifyFetchedPage({
			status: got.status,
			title: got.title,
			text: got.text,
			priorHash: priorCap[0]?.content_hash,
			priorStatus: priorCap[0]?.fetch_status,
			newHash: hash
		});
		const outcome = got.outcome === "needs-ocr" ? "needs-ocr" : classified;
		const rec = await rememberCapture({
			userId: opts.userId,
			investigationId: m.investigation_id,
			url,
			title: got.title || m.title || url,
			text: got.text,
			hash,
			status: got.status,
			outcome,
			triggerKind: "monitor",
			monitorId: m.id,
			redirectChain: got.redirectChain,
			contentType: got.contentType,
			extractionMethod: got.extractionMethod,
			pages: got.pages,
			extras: got.extras,
			observedAt: now
		});
		const invId = m.investigation_id;
		const gone = outcome === "removed" || outcome === "not-found" || outcome === "soft-404";
		const priorGone = Boolean(priorCap[0]) && (priorCap[0].fetch_status === 404 || priorCap[0].fetch_status === 410 || priorCap[0].content_hash === "missing" || priorCap[0].fetch_outcome === "removed" || priorCap[0].fetch_outcome === "not-found" || priorCap[0].fetch_outcome === "soft-404");
		if (gone) {
			await sql`
        insert into anomalies (user_id, investigation_id, kind, summary, url, details)
        values (
          ${opts.userId}, ${invId}, ${"disappeared"},
          ${`Monitored record disappeared: ${url}`},
          ${url},
          ${`Monitor ${m.id}. Outcome ${outcome}. Status ${got.status}. No human reopen required.`}
        )
      `;
			anomalies += 1;
			if (invId) {
				await persistDiscovery(opts.userId, invId, {
					kind: "missing-record",
					label: url,
					why: "Autonomous monitor detected disappearance",
					evidence: url,
					priority: 12
				});
				try {
					const copies = opts.archives ? await opts.archives(url) : await waybackCopies(url);
					for (const c of copies.slice(0, 3)) await persistDiscovery(opts.userId, invId, {
						kind: "url",
						label: c,
						why: `Archive copy after monitored disappearance of ${url}`,
						evidence: url,
						priority: 12
					});
				} catch {}
			}
		} else {
			if (priorGone && (outcome === "fetched" || outcome === "changed")) {
				await sql`
          insert into anomalies (user_id, investigation_id, kind, summary, url, details)
          values (
            ${opts.userId}, ${invId}, ${"restored"},
            ${`Monitored record restored: ${url}`},
            ${url},
            ${`Prior outcome ${priorCap[0]?.fetch_outcome ?? "missing"}. New hash ${hash}.`}
          )
        `;
				anomalies += 1;
				if (invId) {
					const rows = await sql`
            select id from frontier_items
            where user_id = ${opts.userId} and investigation_id = ${invId} and label = ${url}
              and status in ('dead-end', 'exhausted', 'deferred')
            limit 1
          `;
					if (rows[0]) await sql`
              update frontier_items
              set status = ${"reopened"}, closed_reason = ${"Monitored source restored"}
              where id = ${rows[0].id}
            `;
				}
			}
			if (outcome === "changed") {
				await sql`
          insert into anomalies (user_id, investigation_id, kind, summary, url, details)
          values (
            ${opts.userId}, ${invId}, ${"changed"},
            ${`Monitored record changed: ${url}`},
            ${url},
            ${diffExcerpt(priorCap[0]?.full_text ?? "", got.text).slice(0, 4e3)}
          )
        `;
				anomalies += 1;
				let prevSnap = null;
				try {
					if (m.typical_structure) prevSnap = JSON.parse(m.typical_structure);
				} catch {
					prevSnap = null;
				}
				anomalies += await flagPatternAnomalies({
					userId: opts.userId,
					investigationId: invId,
					url,
					title: got.title || m.title || url,
					text: got.text,
					extras: got.extras,
					previous: prevSnap,
					now
				});
			}
		}
		if (got.ok) await observeBaseline(opts.userId, url, got.title || m.title, now, got.extras);
		const hours = m.cadence_hours || 24;
		const next = new Date(now.getTime() + hours * 3600 * 1e3).toISOString();
		const successAt = got.ok ? now.toISOString() : null;
		const structure = JSON.stringify(structureSnapshot(got.title || m.title, got.text, got.extras));
		await sql`
      update source_monitors
      set last_check_at = ${now.toISOString()}::timestamptz,
          last_outcome = ${outcome},
          last_version_id = ${rec.versionId},
          last_success_at = ${successAt}::timestamptz,
          next_check_at = ${next}::timestamptz,
          typical_structure = ${structure}
      where id = ${m.id}
    `;
	}
	return {
		checked: due.length,
		anomalies
	};
}
var HANDOFFS = /* @__PURE__ */ new Set([
	"DISCARD",
	"HOLD FOR PATTERN",
	"MONITOR",
	"FOR VERIFICATION",
	"CONTINUE",
	"FINDING",
	"DEAD END"
]);
async function ensureDarkSchema() {
	const sql = await getSql();
	await sql.query(`
    create table if not exists dark_runs (
      id serial primary key,
      user_id text not null,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      summary text,
      error text
    )
  `);
	await sql.query(`create index if not exists dark_runs_user_idx on dark_runs (user_id, started_at desc)`);
	await sql.query(`
    create table if not exists dark_signals (
      id serial primary key,
      user_id text not null,
      run_id integer references dark_runs(id) on delete set null,
      name text not null,
      posture text not null,
      signal_type text not null,
      strength integer not null default 3,
      confidence numeric not null default 0.3,
      observation text not null default '',
      pattern text not null default '',
      linkage_map text not null default '',
      alternatives text not null default '',
      counter_narrative text not null default '',
      what_would_kill text not null default '',
      pathway text not null default '',
      privacy_review text not null default '',
      handoff text not null default 'HOLD FOR PATTERN',
      investigation_id integer,
      created_at timestamptz not null default now()
    )
  `);
	await sql.query(`create index if not exists dark_signals_user_idx on dark_signals (user_id, created_at desc)`);
	try {
		await sql.query(`alter table dark_signals add column if not exists investigation_id integer`);
	} catch {}
	await sql.query(`
    create table if not exists dark_promises (
      id serial primary key,
      user_id text not null,
      who_promised text not null,
      what text not null,
      when_due text,
      source_cite text,
      status text not null default 'open',
      created_at timestamptz not null default now()
    )
  `);
	await sql.query(`create index if not exists dark_promises_user_idx on dark_promises (user_id, created_at desc)`);
	await ensureInvestigateSchema();
}
var listDarkSignals_createServerFn_handler = createServerRpc({
	id: "3e6006df6fac7044e94a5f88a8f5233abf5de4ea74b799291d4022966ae12e34",
	name: "listDarkSignals",
	filename: "src/lib/news/dark.ts"
}, (opts) => listDarkSignals.__executeServer(opts));
var listDarkSignals = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(listDarkSignals_createServerFn_handler, async ({ context }) => {
	await ensureDarkSchema();
	return (await getSql())`
      select id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff, created_at
      from dark_signals
      where user_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
});
var listDarkRuns_createServerFn_handler = createServerRpc({
	id: "ed0e725a7bea9c56f7276c2ff3f726173c5c7cd552bb421fe2ac2a177c7628d2",
	name: "listDarkRuns",
	filename: "src/lib/news/dark.ts"
}, (opts) => listDarkRuns.__executeServer(opts));
var listDarkRuns = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(listDarkRuns_createServerFn_handler, async ({ context }) => {
	await ensureDarkSchema();
	return (await getSql())`
      select id, started_at, finished_at, summary, error
      from dark_runs
      where user_id = ${context.userId}
      order by started_at desc
      limit 12
    `;
});
var listDarkPromises_createServerFn_handler = createServerRpc({
	id: "6f97a86c3c56a496a387a66c953720cf87b355303663b8b6ca5fa46c61ecb62f",
	name: "listDarkPromises",
	filename: "src/lib/news/dark.ts"
}, (opts) => listDarkPromises.__executeServer(opts));
var listDarkPromises = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(listDarkPromises_createServerFn_handler, async ({ context }) => {
	await ensureDarkSchema();
	return (await getSql())`
      select id, who_promised, what, when_due, source_cite, status, created_at
      from dark_promises
      where user_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
});
var listInvestigations_createServerFn_handler = createServerRpc({
	id: "cb24cae7c2cb40b67e0cdd95fc22fb31dbc3f6d9c074666f7d2c576e5a3dd1bc",
	name: "listInvestigations",
	filename: "src/lib/news/dark.ts"
}, (opts) => listInvestigations.__executeServer(opts));
var listInvestigations = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(listInvestigations_createServerFn_handler, async ({ context }) => {
	await ensureDarkSchema();
	return (await getSql())`
      select id, title, status, summary, hops, budget, created_at, updated_at
      from investigations
      where user_id = ${context.userId}
      order by updated_at desc
      limit 20
    `;
});
var getInvestigation_createServerFn_handler = createServerRpc({
	id: "e48c684a8f0274db48e43e6a48f5cbebe2cc99bf7d76b5f8a9e010ce7b7da5f1",
	name: "getInvestigation",
	filename: "src/lib/news/dark.ts"
}, (opts) => getInvestigation.__executeServer(opts));
var getInvestigation = createServerFn({ method: "GET" }).middleware([deskMiddleware]).validator((id) => id).handler(getInvestigation_createServerFn_handler, async ({ context, data: id }) => {
	await ensureDarkSchema();
	const sql = await getSql();
	const inv = await sql`
      select id, title, status, summary, hops, budget, created_at, updated_at
      from investigations where id = ${id} and user_id = ${context.userId} limit 1
    `;
	if (!inv[0]) return null;
	const frontier = await sql`
      select id, kind, label, why, priority, status, closed_reason from frontier_items
      where investigation_id = ${id} and user_id = ${context.userId}
      order by priority desc, id desc limit 40
    `;
	const artifacts = await sql`
      select id, url, title, classification, fetch_status, fetch_outcome, version_id, created_at from artifacts
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 40
    `;
	const entities = await sql`
      select e.name, e.kind, e.why
      from investigation_entities ie
      join entities e on e.id = ie.entity_id
      where ie.investigation_id = ${id} and ie.user_id = ${context.userId}
      order by ie.id desc limit 40
    `;
	const historicalEntities = await sql`
      select e.name, e.kind, e.why, ie.investigation_id, m.verdict
      from entities e
      join investigation_entities ie on ie.entity_id = e.id
      left join entity_matches m on m.user_id = ${context.userId}
        and (
          (m.left_canonical = e.canonical and m.right_canonical in (
            select e2.canonical from investigation_entities x
            join entities e2 on e2.id = x.entity_id
            where x.investigation_id = ${id} and x.user_id = ${context.userId}
          ))
          or (m.right_canonical = e.canonical and m.left_canonical in (
            select e2.canonical from investigation_entities x
            join entities e2 on e2.id = x.entity_id
            where x.investigation_id = ${id} and x.user_id = ${context.userId}
          ))
        )
      where e.user_id = ${context.userId}
        and ie.investigation_id <> ${id}
        and (
          e.canonical in (
            select e2.canonical from investigation_entities x
            join entities e2 on e2.id = x.entity_id
            where x.investigation_id = ${id} and x.user_id = ${context.userId}
          )
          or m.id is not null
        )
      order by ie.id desc
      limit 12
    `;
	const relationships = await sql`
      select from_name, to_name, kind, evidence, version_id, capture_event_id, provenance_status from relationships
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 40
    `;
	const claims = await sql`
      select body, kind, evidence, confidence, version_id, capture_event_id, provenance_status from claims
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 40
    `;
	const hypotheses = await sql`
      select body, status, supporting, contradicting from hypotheses
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 20
    `;
	const anomalies = await sql`
      select kind, summary, url from anomalies
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 20
    `;
	const deadEnds = await sql`
      select hypothesis, dismissed_because from dead_ends
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 20
    `;
	const searches = await sql`
      select hop, query, state, provider from search_log
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 40
    `;
	return {
		investigation: inv[0],
		frontier,
		artifacts,
		entities,
		historicalEntities,
		relationships,
		claims,
		hypotheses,
		anomalies,
		deadEnds,
		searches
	};
});
async function synthesizeSignals(userId, runId, investigationId, paste) {
	const sql = await getSql();
	const sources = await sql`
    select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error
    from sources where user_id = ${userId} order by id asc
  `;
	const arts = await sql`
    select title, url, full_text from artifacts
    where investigation_id = ${investigationId} and user_id = ${userId}
    order by id desc limit 12
  `;
	const frontier = await sql`
    select label, kind, why from frontier_items
    where investigation_id = ${investigationId} and user_id = ${userId} and status in ('open', 'investigating', 'reopened')
    order by priority desc limit 16
  `;
	const rels = await sql`
    select from_name, to_name, kind from relationships
    where investigation_id = ${investigationId} and user_id = ${userId} limit 20
  `;
	const claims = await sql`
    select body, kind from claims
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 12
  `;
	const hyps = await sql`
    select body, status from hypotheses
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 12
  `;
	const anoms = await sql`
    select kind, summary from anomalies
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 10
  `;
	const leads = await sql`
    select headline, why, topic, status from leads where user_id = ${userId} order by created_at desc limit 8
  `;
	const articles = await sql`
    select headline, topic, published_at from articles
    where user_id = ${userId} and status = 'published' order by published_at desc limit 6
  `;
	const memory = await sql`
    select entity, last_angle from beat_memory where user_id = ${userId} order by updated_at desc limit 12
  `;
	const searches = await sql`
    select query from search_log where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 20
  `;
	const pack = [
		`CITY: Longmont, Colorado. Investigation ${investigationId}. Watch list is a start, not a boundary.`,
		`WATCH LIST:\n${sources.map((s) => `${s.tier} ${s.status} ${s.title} ${s.url}`).join("\n") || "(empty)"}`,
		`SEARCHES RUN:\n${searches.map((s) => s.query).join("\n") || "(none)"}`,
		`FRONTIER:\n${frontier.map((f) => `${f.kind}: ${f.label} — ${f.why}`).join("\n") || "(none)"}`,
		`RELATIONSHIPS:\n${rels.map((r) => `${r.from_name} -[${r.kind}]-> ${r.to_name}`).join("\n") || "(none)"}`,
		`CLAIMS:\n${claims.map((c) => `${c.kind}: ${c.body}`).join("\n") || "(none)"}`,
		`HYPOTHESES:\n${hyps.map((h) => `[${h.status}] ${h.body}`).join("\n") || "(none)"}`,
		`ANOMALIES:\n${anoms.map((a) => `${a.kind}: ${a.summary}`).join("\n") || "(none)"}`,
		`ARTIFACTS:\n${arts.map((s) => `### ${s.title}\n${s.url}\n${s.full_text.slice(0, 1600)}`).join("\n\n") || "(none)"}`,
		`OPEN LEADS:\n${leads.map((l) => `${l.status} ${l.topic}: ${l.headline}`).join("\n") || "(none)"}`,
		`PUBLISHED:\n${articles.map((a) => `${a.topic}: ${a.headline}`).join("\n") || "(none)"}`,
		`BEAT MEMORY:\n${memory.map((m) => `${m.entity}: ${m.last_angle}`).join("\n") || "(none)"}`,
		paste ? `EDITOR PASTE:\n${paste.slice(0, 8e3)}` : "EDITOR PASTE: (none)"
	].join("\n\n");
	const ai = await grokChat(DARK_SYSTEM, pack.slice(0, 28e3), 3200);
	if (!ai.ok) return {
		stored: 0,
		summary: "",
		error: ai.error
	};
	const parsed = parseJsonBlock(ai.text) ?? {};
	const summary = String(parsed.editor_summary ?? "").slice(0, 2e3);
	const gaps = (parsed.inventory_gaps ?? []).join("; ").slice(0, 800);
	const header = [
		summary,
		gaps ? `Gaps: ${gaps}` : "",
		parsed.window ? `Window: ${parsed.window}` : ""
	].filter(Boolean).join("\n");
	let stored = 0;
	for (const sig of parsed.signals ?? []) {
		const name = String(sig.name ?? "").trim();
		if (!name) continue;
		const strength = Math.min(15, Math.max(3, Number(sig.strength) || 3));
		const confidence = Math.min(1, Math.max(0, Number(sig.confidence) || .3));
		let handoff = String(sig.handoff ?? "HOLD FOR PATTERN").toUpperCase();
		if (!HANDOFFS.has(handoff)) handoff = "HOLD FOR PATTERN";
		await sql`
      insert into dark_signals (
        user_id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff
      ) values (
        ${userId}, ${runId}, ${investigationId}, ${name.slice(0, 200)},
        ${String(sig.posture ?? "").slice(0, 80)},
        ${String(sig.type ?? "").slice(0, 80)},
        ${strength}, ${confidence},
        ${String(sig.observation ?? "").slice(0, 4e3)},
        ${String(sig.pattern ?? "").slice(0, 4e3)},
        ${String(sig.linkage_map ?? "").slice(0, 4e3)},
        ${String(sig.alternatives ?? "").slice(0, 4e3)},
        ${String(sig.counter_narrative ?? "").slice(0, 4e3)},
        ${String(sig.what_would_kill ?? "").slice(0, 2e3)},
        ${String(sig.pathway ?? "").slice(0, 2e3)},
        ${String(sig.privacy_review ?? "").slice(0, 500)},
        ${handoff}
      )
    `;
		stored += 1;
	}
	for (const p of parsed.promises ?? []) {
		const who = String(p.who ?? "").trim();
		const what = String(p.what ?? "").trim();
		if (!who || !what) continue;
		await sql`
      insert into dark_promises (user_id, who_promised, what, when_due, source_cite, status)
      values (
        ${userId}, ${who.slice(0, 200)}, ${what.slice(0, 800)},
        ${String(p.when_due ?? "").slice(0, 120) || null},
        ${String(p.source_cite ?? "").slice(0, 400) || null},
        ${String(p.status ?? "open").slice(0, 40)}
      )
    `;
	}
	return {
		stored,
		summary: header,
		error: void 0
	};
}
var runDarkDesk_createServerFn_handler = createServerRpc({
	id: "9b255f8e2895f56be8f515b012c024fd145d7a71860053e1b3d66294b9bf5d72",
	name: "runDarkDesk",
	filename: "src/lib/news/dark.ts"
}, (opts) => runDarkDesk.__executeServer(opts));
var runDarkDesk = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((input) => input).handler(runDarkDesk_createServerFn_handler, async ({ context, data }) => {
	await ensureDarkSchema();
	await assertRate(context.userId, "dark");
	const sql = await getSql();
	const runId = (await sql`
      insert into dark_runs (user_id) values (${context.userId}) returning id
    `)[0].id;
	const paste = data.paste.trim().slice(0, 14e3);
	let investigationId = data.investigationId ?? 0;
	if (!investigationId) {
		const title = paste.slice(0, 80).replace(/\s+/g, " ") || `Investigation ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
		investigationId = (await sql`
        insert into investigations (user_id, title, budget)
        values (${context.userId}, ${title.slice(0, 200)}, ${5})
        returning id
      `)[0].id;
		const snaps = await sql`
        select s.title, s.url, snap.excerpt
        from snapshots snap
        join sources s on s.id = snap.source_id
        where snap.user_id = ${context.userId}
        order by snap.id desc
        limit 16
      `;
		await seedInvestigation(context.userId, investigationId, paste, snaps);
	}
	await checkBaselines(context.userId, investigationId);
	await runDueMonitors({ userId: context.userId });
	const loop = await researchLoop({
		userId: context.userId,
		investigationId,
		hops: 5
	});
	const synth = await synthesizeSignals(context.userId, runId, investigationId, paste);
	const names = (await sql`
        select e.name from investigation_entities ie
        join entities e on e.id = ie.entity_id
        where ie.investigation_id = ${investigationId} and ie.user_id = ${context.userId}
        order by ie.id desc limit 40
      `).map((n) => n.name);
	await resurfaceDeadEnds(context.userId, investigationId, names, { foreignOnly: true });
	const revived = await matchDeadEnds(context.userId, names);
	const header = [
		loop.summary,
		synth.summary,
		`Hops ${loop.hops}. Artifacts ${loop.artifacts}. Open frontier ${loop.frontier}.`,
		revived.length ? `Prior dead ends matched: ${revived.map((r) => r.hypothesis).join("; ")}` : "",
		synth.error ? `Synthesis: ${synth.error}` : ""
	].filter(Boolean).join("\n");
	await sql`
      update dark_runs
      set finished_at = now(), summary = ${header.slice(0, 2500)}, error = ${synth.error ?? null}
      where id = ${runId} and user_id = ${context.userId}
    `;
	await audit(context.userId, "dark", `run ${runId} inv ${investigationId} hops ${loop.hops} signals ${synth.stored}`);
	return {
		ok: true,
		runId,
		investigationId,
		stored: synth.stored,
		hops: loop.hops,
		artifacts: loop.artifacts,
		frontier: loop.frontier,
		paused: loop.paused,
		summary: header
	};
});
var continueInvestigation_createServerFn_handler = createServerRpc({
	id: "e9fcd3306e40ea957a28af78bd4a4669497cb889d27fe8e19b27a91a200caaf0",
	name: "continueInvestigation",
	filename: "src/lib/news/dark.ts"
}, (opts) => continueInvestigation.__executeServer(opts));
var continueInvestigation = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((id) => id).handler(continueInvestigation_createServerFn_handler, async ({ context, data: id }) => {
	await ensureDarkSchema();
	await assertRate(context.userId, "dark");
	const sql = await getSql();
	if (!(await sql`
      select id from investigations where id = ${id} and user_id = ${context.userId} limit 1
    `)[0]) return {
		ok: false,
		error: "Investigation not found"
	};
	const runId = (await sql`
      insert into dark_runs (user_id) values (${context.userId}) returning id
    `)[0].id;
	await checkBaselines(context.userId, id);
	await runDueMonitors({ userId: context.userId });
	const loop = await researchLoop({
		userId: context.userId,
		investigationId: id,
		hops: 5
	});
	const synth = await synthesizeSignals(context.userId, runId, id, "");
	const names = (await sql`
        select e.name from investigation_entities ie
        join entities e on e.id = ie.entity_id
        where ie.investigation_id = ${id} and ie.user_id = ${context.userId}
        order by ie.id desc limit 40
      `).map((n) => n.name);
	await resurfaceDeadEnds(context.userId, id, names, { foreignOnly: true });
	const revived = await matchDeadEnds(context.userId, names);
	const header = [
		loop.summary,
		synth.summary,
		`Hops ${loop.hops}. Artifacts ${loop.artifacts}. Open frontier ${loop.frontier}.`,
		revived.length ? `Prior dead ends matched: ${revived.map((r) => r.hypothesis).join("; ")}` : "",
		synth.error ? `Synthesis: ${synth.error}` : ""
	].filter(Boolean).join("\n");
	await sql`
      update dark_runs
      set finished_at = now(), summary = ${header.slice(0, 2500)}, error = ${synth.error ?? null}
      where id = ${runId} and user_id = ${context.userId}
    `;
	await audit(context.userId, "dark-continue", `run ${runId} inv ${id} hops ${loop.hops} signals ${synth.stored}`);
	return {
		ok: true,
		runId,
		investigationId: id,
		stored: synth.stored,
		hops: loop.hops,
		artifacts: loop.artifacts,
		frontier: loop.frontier,
		paused: loop.paused,
		summary: header
	};
});
var sendDarkSignalToQueue_createServerFn_handler = createServerRpc({
	id: "3adf87a84026d2554afed3147bc3a92b809dbf9b978c275fabba358da73f0c5d",
	name: "sendDarkSignalToQueue",
	filename: "src/lib/news/dark.ts"
}, (opts) => sendDarkSignalToQueue.__executeServer(opts));
var sendDarkSignalToQueue = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((id) => id).handler(sendDarkSignalToQueue_createServerFn_handler, async ({ context, data: id }) => {
	await ensureDarkSchema();
	const sql = await getSql();
	const sig = (await sql`
      select id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff, created_at
      from dark_signals where id = ${id} and user_id = ${context.userId} limit 1
    `)[0];
	if (!sig) return {
		ok: false,
		error: "Signal not found"
	};
	const arts = sig.investigation_id ? await sql`
          select url from artifacts
          where user_id = ${context.userId} and investigation_id = ${sig.investigation_id}
          order by id desc limit 12
        ` : await sql`
          select url from artifacts
          where user_id = ${context.userId}
          order by id desc limit 12
        `;
	const urls = JSON.stringify(sanitizePublicUrls(arts.map((a) => a.url)));
	const why = [
		`DARK DESK investigation notes. Claim kinds in the evidence. Publication is a separate human action.`,
		`Posture: ${sig.posture}. Type: ${sig.signal_type}. Strength ${sig.strength} / confidence ${sig.confidence}.`,
		sig.observation,
		`Linkage: ${sig.linkage_map}`,
		`Alternatives: ${sig.alternatives}`,
		`Pathway: ${sig.pathway}`
	].filter(Boolean).join("\n\n").slice(0, 4e3);
	const created = await sql`
      insert into leads (user_id, headline, why, topic, status, source_urls, evidence, newsworthiness, investigation_id)
      values (
        ${context.userId},
        ${sig.name.slice(0, 240)},
        ${why},
        'council',
        'new',
        ${urls},
        ${sig.observation.slice(0, 4e3)},
        ${Math.min(20, sig.strength)},
        ${sig.investigation_id}
      )
      returning id
    `;
	await audit(context.userId, "dark-handoff", String(id));
	return {
		ok: true,
		leadId: created[0].id
	};
});
//#endregion
export { continueInvestigation_createServerFn_handler, getInvestigation_createServerFn_handler, listDarkPromises_createServerFn_handler, listDarkRuns_createServerFn_handler, listDarkSignals_createServerFn_handler, listInvestigations_createServerFn_handler, runDarkDesk_createServerFn_handler, sendDarkSignalToQueue_createServerFn_handler };
