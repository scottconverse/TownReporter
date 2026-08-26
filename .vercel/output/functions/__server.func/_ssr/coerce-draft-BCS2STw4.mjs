import { r as TOPICS } from "./paper-DHP8VcIV.mjs";
import { a as parseJsonBlock } from "./ai-BuLkq9Lu.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/coerce-draft-BCS2STw4.js
function looksLikeJsonDraft(text) {
	const t = text.trim();
	return t.startsWith("{") && /"headline"\s*:/.test(t) && /"body"\s*:/.test(t);
}
function asTopic(value, fallback) {
	const s = String(value ?? fallback).trim();
	return TOPICS.includes(s) ? s : fallback;
}
/** Pull a JSON string field even when the model left inner quotes unescaped. */
function extractQuoted(raw, key) {
	const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(raw);
	if (!m) return void 0;
	const rest = raw.slice(m.index + m[0].length);
	const term = rest.search(/"\s*,\s*"(?:headline|dek|body|topic|source_urls|integrity_notes|memory_entities)"|"\s*}/);
	return (term >= 0 ? rest.slice(0, term) : rest).replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}
function fromObject(obj, fallback) {
	const headline = String(obj.headline ?? fallback.headline).trim().slice(0, 240) || fallback.headline;
	const dek = String(obj.dek ?? fallback.dek).trim().slice(0, 400);
	let body = String(obj.body ?? "").trim();
	if (looksLikeJsonDraft(body)) {
		const inner = parseJsonBlock(body);
		if (inner && typeof inner.body === "string") body = String(inner.body).trim();
	}
	return {
		headline,
		dek,
		body,
		topic: asTopic(obj.topic, fallback.topic),
		source_urls: obj.source_urls,
		integrity_notes: String(obj.integrity_notes ?? "").trim().slice(0, 2e3),
		memory_entities: Array.isArray(obj.memory_entities) ? obj.memory_entities.map((x) => String(x).slice(0, 80)).slice(0, 16) : []
	};
}
/**
* Turn a Grok draft reply into fields. Never return the raw JSON blob as body.
*/
function coerceDraft(raw, fallback) {
	const parsed = parseJsonBlock(raw);
	if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
		const out = fromObject(parsed, fallback);
		if (out.body && !looksLikeJsonDraft(out.body)) return out;
	}
	const headline = extractQuoted(raw, "headline")?.trim().slice(0, 240) || fallback.headline;
	const dek = extractQuoted(raw, "dek")?.trim().slice(0, 400) || fallback.dek;
	const body = extractQuoted(raw, "body")?.trim() ?? "";
	const topic = asTopic(extractQuoted(raw, "topic"), fallback.topic);
	const notes = extractQuoted(raw, "integrity_notes")?.trim().slice(0, 2e3) ?? "";
	if (body && !looksLikeJsonDraft(body)) return {
		headline,
		dek,
		body,
		topic,
		source_urls: [],
		integrity_notes: notes,
		memory_entities: []
	};
	return {
		headline,
		dek,
		body: body && !looksLikeJsonDraft(body) ? body : "",
		topic,
		source_urls: [],
		integrity_notes: notes,
		memory_entities: []
	};
}
function unpackStoredDraft(draft) {
	if (!looksLikeJsonDraft(draft.body)) return draft;
	const c = coerceDraft(draft.body, {
		headline: draft.headline,
		dek: draft.dek,
		topic: draft.topic
	});
	if (!c.body) return draft;
	return {
		...draft,
		headline: c.headline,
		dek: c.dek,
		body: c.body,
		topic: c.topic
	};
}
//#endregion
export { unpackStoredDraft as n, coerceDraft as t };
