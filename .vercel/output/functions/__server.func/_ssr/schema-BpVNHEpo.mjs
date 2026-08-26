import { c as getSql, r as TOPICS } from "./paper-DHP8VcIV.mjs";
import { A as array, I as object, O as _enum, z as string } from "../_libs/@better-auth/core+[...].mjs";
import { n as number } from "../_libs/zod.mjs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
//#region node_modules/.nitro/vite/services/ssr/assets/schema-BpVNHEpo.js
var HOURLY = {
	scan: 10,
	draft: 20,
	dark: 8
};
async function assertRate(userId, action) {
	const cap = HOURLY[action] ?? 20;
	const sql = await getSql();
	await sql.query(`
    create table if not exists desk_rate (
      id serial primary key,
      user_id text not null,
      action text not null,
      created_at timestamptz not null default now()
    )
  `);
	if (((await sql`
    select count(*)::int as c from desk_rate
    where user_id = ${userId} and action = ${action}
      and created_at > now() - interval '1 hour'
  `)[0]?.c ?? 0) >= cap) throw new Error(`Rate limit: ${action} is capped at ${cap} per hour.`);
	await sql`
    insert into desk_rate (user_id, action) values (${userId}, ${action})
  `;
}
async function audit(userId, action, detail) {
	const sql = await getSql();
	await sql.query(`
    create table if not exists audit_events (
      id serial primary key,
      user_id text not null,
      action text not null,
      detail text not null default '',
      created_at timestamptz not null default now()
    )
  `);
	await sql`
    insert into audit_events (user_id, action, detail)
    values (${userId}, ${action}, ${detail.slice(0, 500)})
  `;
}
function isBlockedAddress(ip) {
	const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
	if (raw.startsWith("::ffff:") && raw.includes(".")) return isBlockedAddress(raw.slice(raw.lastIndexOf(":") + 1));
	if (raw.includes(".")) {
		const p = raw.split(".").map(Number);
		if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
		const [a, b] = p;
		if (a === 0 || a === 10 || a === 127) return true;
		if (a === 169 && b === 254) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
		if (a >= 224) return true;
		return false;
	}
	if (raw === "::1" || raw === "::" || raw === "0:0:0:0:0:0:0:1") return true;
	if (raw.startsWith("fc") || raw.startsWith("fd")) return true;
	if (raw.startsWith("fe80")) return true;
	if (raw.startsWith("ff")) return true;
	return false;
}
function assertHttpUrl(raw) {
	let url;
	try {
		url = new URL(raw.trim());
	} catch {
		throw new Error("Invalid URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (isIP(host) && isBlockedAddress(host)) throw new Error("That host is not fetchable");
	if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) throw new Error("That host is not fetchable");
	return url;
}
async function assertPublicHttpUrl(raw) {
	const url = assertHttpUrl(raw);
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (isIP(host)) {
		if (isBlockedAddress(host)) throw new Error("That host is not fetchable");
		return url;
	}
	let records;
	try {
		records = await lookup(host, { all: true });
	} catch {
		throw new Error("That host could not be resolved");
	}
	if (!records.length) throw new Error("That host could not be resolved");
	for (const r of records) if (isBlockedAddress(r.address)) throw new Error("That host is not fetchable");
	return url;
}
async function fetchPublicHttpTracked(url, hops = 4) {
	const chain = [url.toString()];
	async function go(u, left) {
		await assertPublicHttpUrl(u.toString());
		const res = await fetch(u, {
			redirect: "manual",
			headers: {
				"User-Agent": "TownReporter/1.0 (+https://grok.me; civic newspaper source fetch)",
				Accept: "text/html,application/xhtml+xml,application/xml,text/plain,application/pdf;q=0.8,*/*;q=0.1"
			},
			signal: AbortSignal.timeout(1e4)
		});
		if ([
			301,
			302,
			303,
			307,
			308
		].includes(res.status)) {
			if (left <= 0) throw new Error("Too many redirects");
			const loc = res.headers.get("location");
			if (!loc) throw new Error("Redirect with no location");
			const next = new URL(loc, u);
			chain.push(next.toString());
			return go(next, left - 1);
		}
		return res;
	}
	return {
		response: await go(url, hops),
		chain,
		finalUrl: chain[chain.length - 1]
	};
}
async function fetchPublicHttp(url, hops = 4) {
	return (await fetchPublicHttpTracked(url, hops)).response;
}
function stripHtml(html) {
	return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&#39;/g, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}
function youtubeVideoId(url) {
	const host = url.hostname.replace(/^www\./, "");
	if (host === "youtu.be") {
		const id = url.pathname.split("/").filter(Boolean)[0];
		return id && !id.startsWith("@") ? id : null;
	}
	if (host === "youtube.com" || host === "m.youtube.com") return url.searchParams.get("v");
	return null;
}
function isYoutubeChannel(url) {
	const host = url.hostname.replace(/^www\./, "");
	if (host !== "youtube.com" && host !== "m.youtube.com") return false;
	const p = url.pathname;
	return p.startsWith("/@") || p.startsWith("/channel/") || p.startsWith("/c/") || p.startsWith("/user/") || p.endsWith("/videos") || p.endsWith("/streams");
}
async function fetchYoutubeCaptions(videoId) {
	const timed = new URL("https://www.youtube.com/api/timedtext");
	timed.searchParams.set("v", videoId);
	timed.searchParams.set("lang", "en");
	timed.searchParams.set("fmt", "srv3");
	const res = await fetchPublicHttp(timed);
	if (!res.ok) return null;
	const text = stripHtml(await res.text());
	return text.length > 40 ? text : null;
}
async function fetchSourceText(rawUrl) {
	const url = await assertPublicHttpUrl(rawUrl);
	const videoId = youtubeVideoId(url);
	if (videoId) {
		const captions = await fetchYoutubeCaptions(videoId);
		if (captions) return {
			text: `YouTube captions (auto or manual; verify quotes against the video).\nVideo ${videoId}\n\n${captions}`,
			titleHint: `YouTube ${videoId}`
		};
	}
	if (isYoutubeChannel(url)) {
		const html = await (await fetchPublicHttp(url)).text();
		const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		const titleHint = titleMatch ? stripHtml(titleMatch[1]).slice(0, 140) : url.hostname;
		return {
			text: `YouTube channel/listing URL — not a single video. Captions need a watch URL with v=. Do not treat this as a transcript.\n\n${stripHtml(html).slice(0, 14e3)}`,
			titleHint
		};
	}
	const res = await fetchPublicHttp(url);
	if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
	const ctype = res.headers.get("content-type") ?? "";
	if (/pdf|octet-stream|zip|image\//i.test(ctype)) throw new Error(`Unsupported content type: ${ctype || "unknown"}`);
	if (ctype && !/text\/html|application\/xhtml|application\/xml|text\/plain|application\/json|text\/xml/i.test(ctype)) throw new Error(`Unsupported content type: ${ctype}`);
	const html = await res.text();
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const titleHint = titleMatch ? stripHtml(titleMatch[1]).slice(0, 140) : url.hostname;
	const text = stripHtml(html).slice(0, 14e3);
	if (text.length < 40) throw new Error("Page had almost no readable text");
	return {
		text,
		titleHint
	};
}
async function sha256(text) {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var SOFT_404 = [
	"404 not found",
	"page not found",
	"the page you requested",
	"this page cannot be found",
	"doesn't exist",
	"does not exist",
	"no longer available",
	"has been removed",
	"file not found",
	"we couldn't find",
	"cannot find the page",
	"error 404",
	"not found |"
];
function looksLikeSoft404(title, text) {
	const blob = `${title}\n${text}`.toLowerCase();
	const hits = SOFT_404.filter((n) => blob.includes(n)).length;
	if (title.toLowerCase().includes("404")) return true;
	if (/\bnot found\b/i.test(title) && text.length < 4e3) return true;
	if (hits >= 1 && text.length < 2800) return true;
	if (hits >= 2) return true;
	return false;
}
function classifyHttpStatus(status) {
	if (status === 404 || status === 410) return "not-found";
	if (status === 0) return "fetch-failed";
	if (status >= 300 && status < 400) return "redirected";
	if (status >= 400) return "fetch-failed";
	return null;
}
function classifyFetchedPage(opts) {
	const http = classifyHttpStatus(opts.status);
	if (http === "not-found") return opts.priorStatus === 200 || opts.priorHash && opts.priorHash !== "missing" ? "removed" : "not-found";
	if (http) return http;
	if (looksLikeSoft404(opts.title, opts.text)) return opts.priorStatus === 200 || opts.priorHash && opts.priorHash !== "missing" ? "removed" : "soft-404";
	if (opts.text.trim().length < 40) return "parse-failed";
	if (opts.priorHash && opts.newHash && opts.priorHash === opts.newHash) return "unchanged";
	if (opts.priorHash && opts.priorHash !== "missing" && opts.newHash && opts.priorHash !== opts.newHash) return "changed";
	return "fetched";
}
function canonicalPublicUrl(raw) {
	const u = new URL(raw.trim());
	u.hash = "";
	u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
	for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$|^mc_cid$|^mc_eid$/i.test(k)) u.searchParams.delete(k);
	if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
	return u.toString();
}
function classifySearchHtml(status, html, parsedCount) {
	if (status === 0) return "SEARCH_FAILED_NETWORK";
	if (status === 408 || status === 504) return "SEARCH_TIMEOUT";
	if (status === 403 || status === 429) return "SEARCH_BLOCKED";
	if (status >= 500) return "SEARCH_FAILED_PROVIDER";
	if (status >= 400) return "SEARCH_FAILED_PROVIDER";
	const low = html.toLowerCase();
	if (/captcha|anomaly-modal|enable javascript|please verify you are|are you a robot|cdn-cgi\/challenge/.test(low)) return "SEARCH_BLOCKED";
	if (parsedCount > 0) return "SEARCH_SUCCESS_RESULTS";
	if (html.trim().length < 40) return "SEARCH_FAILED_PARSE";
	if (/no results|did not match|0 results/.test(low)) return "SEARCH_SUCCESS_ZERO_RESULTS";
	if (html.length > 500 && parsedCount === 0) return "SEARCH_FAILED_PARSE";
	return "SEARCH_SUCCESS_ZERO_RESULTS";
}
/** Archive cap. Planner context is sliced at retrieval, never here. */
var ARCHIVE_TEXT_CAP = 2e6;
var CHUNK_SIZE = 2e3;
async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i], i);
		}
	}
	const n = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: n }, () => worker()));
	return out;
}
async function withRetry(fn) {
	try {
		return await fn();
	} catch (err) {
		const msg = err instanceof Error ? err.message : "";
		if (/not fetchable|Invalid URL|Only http/i.test(msg)) throw err;
		await new Promise((r) => setTimeout(r, 400));
		return fn();
	}
}
function decodePdfString(raw) {
	return raw.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "	").replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\").replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}
/** Best-effort text from a PDF without a native parser. Civic packets are often uncompressed. */
function extractPdfText(buf) {
	const latin = new TextDecoder("latin1").decode(buf);
	const chunks = [];
	const tj = /\((?:\\.|[^\\)]){2,}\)(?:\s*Tj|\s*TJ)/g;
	let m;
	while (m = tj.exec(latin)) {
		const inner = m[0].slice(1, m[0].lastIndexOf(")"));
		chunks.push(decodePdfString(inner));
	}
	const hex = /<([0-9A-Fa-f]{4,})>\s*Tj/g;
	while (m = hex.exec(latin)) {
		const hexStr = m[1];
		if (hexStr.length % 2) continue;
		const bytes = hexStr.match(/.{2}/g).map((h) => parseInt(h, 16));
		if (bytes[0] === 254 && bytes[1] === 255) {
			const chars = [];
			for (let i = 2; i + 1 < bytes.length; i += 2) chars.push(String.fromCharCode((bytes[i] << 8) + bytes[i + 1]));
			chunks.push(chars.join(""));
		}
	}
	return chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, ARCHIVE_TEXT_CAP);
}
var ocrImpl = null;
async function extractPdfBetter(buf, impl = void 0) {
	const ocr = impl === void 0 ? ocrImpl : impl;
	try {
		const { extractText } = await import("../_libs/unpdf.mjs").then((n) => n.t);
		const result = await extractText(buf, { mergePages: false });
		const pages = (Array.isArray(result.text) ? result.text : [String(result.text ?? "")]).map((t, i) => ({
			page: i + 1,
			text: String(t ?? "").replace(/\s+/g, " ").trim()
		}));
		const text = pages.map((p) => p.text).filter(Boolean).join("\n\n").trim();
		if (text.length >= 40) return {
			text: text.slice(0, ARCHIVE_TEXT_CAP),
			method: "unpdf",
			needsOcr: false,
			pages
		};
	} catch {}
	const fallback = extractPdfText(buf);
	if (fallback.length >= 40) return {
		text: fallback.slice(0, ARCHIVE_TEXT_CAP),
		method: "tj-regex",
		needsOcr: false,
		pages: [{
			page: 1,
			text: fallback.slice(0, ARCHIVE_TEXT_CAP)
		}]
	};
	if (ocr) try {
		const ocrResult = await ocr(buf);
		if (ocrResult.text.trim().length >= 40) return {
			text: ocrResult.text.slice(0, ARCHIVE_TEXT_CAP),
			method: "ocr",
			needsOcr: false,
			pages: ocrResult.pages.length ? ocrResult.pages : [{
				page: 1,
				text: ocrResult.text.slice(0, ARCHIVE_TEXT_CAP)
			}]
		};
	} catch {}
	return {
		text: fallback,
		method: "none",
		needsOcr: true,
		pages: []
	};
}
function chunkText(text, size = CHUNK_SIZE) {
	const out = [];
	if (!text) return out;
	for (let i = 0, idx = 0; i < text.length; i += size, idx += 1) {
		const excerpt = text.slice(i, i + size);
		out.push({
			index: idx,
			excerpt,
			locator: `char:${i}-${i + excerpt.length}`,
			page_number: null,
			section: ""
		});
	}
	return out;
}
function chunksFromEvidence(text, pages) {
	if (pages && pages.some((p) => p.text.trim())) {
		const out = [];
		let idx = 0;
		for (const p of pages) {
			const body = p.text.trim();
			if (!body) continue;
			if (body.length <= 2e3) out.push({
				index: idx++,
				excerpt: body,
				locator: `page:${p.page}`,
				page_number: p.page,
				section: ""
			});
			else for (const c of chunkText(body)) out.push({
				...c,
				index: idx++,
				page_number: p.page,
				locator: `page:${p.page}:${c.locator}`
			});
		}
		return out;
	}
	return chunkText(text);
}
function parseRssItems(xml) {
	const items = [];
	const blocks = xml.split(/<item[\s>]/i).slice(1);
	const entries = blocks.length ? blocks : xml.split(/<entry[\s>]/i).slice(1);
	for (const block of entries.slice(0, 8)) {
		const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
		const link = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() ?? "";
		const summary = (block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
		if (title || link) items.push({
			title,
			link,
			summary
		});
	}
	return items;
}
var DOC_HREF = /\.pdf(?:$|[?#])|agenda|minutes|packet|staff.?report|ordinance|resolution|budget|attachment/i;
function discoverDocLinks(html, base) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const re = /href\s*=\s*["']([^"']+)["']/gi;
	let m;
	while (m = re.exec(html)) {
		let href = m[1];
		if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) continue;
		try {
			const abs = new URL(href, base);
			if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
			if (!DOC_HREF.test(abs.pathname + abs.search) && !abs.pathname.toLowerCase().endsWith(".pdf")) continue;
			const key = abs.toString();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(key);
		} catch {}
		if (out.length >= 10) break;
	}
	return out;
}
function youtubeChannelId(html) {
	return html.match(/"channelId":"(UC[\w-]+)"/)?.[1] ?? html.match(/https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)/)?.[1] ?? null;
}
function youtubeVideoIdsFromRss(xml) {
	const ids = [];
	const re = /<yt:videoId>([\w-]+)<\/yt:videoId>/g;
	let m;
	while (m = re.exec(xml)) {
		if (!ids.includes(m[1])) ids.push(m[1]);
		if (ids.length >= 3) break;
	}
	if (ids.length === 0) {
		const alt = /watch\?v=([\w-]{6,})/g;
		while (m = alt.exec(xml)) {
			if (!ids.includes(m[1])) ids.push(m[1]);
			if (ids.length >= 3) break;
		}
	}
	return ids;
}
async function ingestDocument(raw) {
	const empty = (over) => ({
		ok: false,
		status: 0,
		outcome: "fetch-failed",
		text: "",
		title: "",
		extras: [],
		contentType: "",
		needsOcr: false,
		redirectChain: [],
		extractionMethod: "",
		pages: [],
		...over
	});
	try {
		const url = await assertPublicHttpUrl(raw);
		const tracked = await fetchPublicHttpTracked(url);
		const res = tracked.response;
		const status = res.status;
		const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
		const buf = new Uint8Array(await res.arrayBuffer());
		const path = url.pathname.toLowerCase();
		if (!res.ok) {
			const title = url.hostname;
			let text = "";
			try {
				text = new TextDecoder("utf-8", { fatal: false }).decode(buf).slice(0, 4e3);
			} catch {
				text = "";
			}
			return empty({
				ok: false,
				status,
				outcome: status === 404 || status === 410 ? "not-found" : "fetch-failed",
				text,
				title,
				contentType: ctype,
				redirectChain: tracked.chain
			});
		}
		if (ctype.includes("pdf") || path.endsWith(".pdf")) {
			const pdf = await extractPdfBetter(buf);
			if (pdf.needsOcr) return empty({
				ok: false,
				status,
				outcome: "needs-ocr",
				text: pdf.text,
				title: url.pathname.split("/").pop() ?? "pdf",
				contentType: "application/pdf",
				needsOcr: true,
				redirectChain: tracked.chain,
				extractionMethod: pdf.method,
				pages: pdf.pages
			});
			return empty({
				ok: true,
				status,
				outcome: "fetched",
				text: `PDF ${url.toString()}\n\n${pdf.text}`.slice(0, ARCHIVE_TEXT_CAP),
				title: url.pathname.split("/").pop() ?? "pdf",
				contentType: "application/pdf",
				redirectChain: tracked.chain,
				extractionMethod: pdf.method,
				pages: pdf.pages
			});
		}
		const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
		const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 140) : url.hostname;
		const text = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, ARCHIVE_TEXT_CAP);
		if (looksLikeSoft404(title, text)) return empty({
			ok: false,
			status,
			outcome: "soft-404",
			text,
			title,
			contentType: ctype,
			redirectChain: tracked.chain,
			extractionMethod: "html"
		});
		const extras = discoverDocLinks(body, url);
		return empty({
			ok: text.length >= 40,
			status,
			outcome: text.length >= 40 ? "fetched" : "parse-failed",
			text,
			title,
			extras,
			contentType: ctype || "text/html",
			redirectChain: tracked.chain,
			extractionMethod: "html"
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : "fetch failed";
		return empty({
			ok: false,
			status: 0,
			outcome: "fetch-failed",
			text: /timeout|aborted/i.test(msg) ? "timeout" : msg
		});
	}
}
async function ingestYoutubeChannel(url) {
	const html = await (await fetchPublicHttp(url)).text();
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const titleHint = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 140) : url.hostname;
	const channelId = youtubeChannelId(html);
	const parts = [`YouTube channel ${url.toString()}. Listing only — captions are pulled from recent watch URLs.`];
	if (channelId) {
		const ids = youtubeVideoIdsFromRss(await (await fetchPublicHttp(new URL(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`))).text());
		parts.push(`Recent videos: ${ids.join(", ") || "(none parsed)"}`);
		for (const id of ids) try {
			const cap = await fetchSourceText(`https://www.youtube.com/watch?v=${id}`);
			parts.push(`--- video ${id} ---\n${cap.text.slice(0, 2500)}`);
		} catch {
			parts.push(`--- video ${id} --- (no captions)`);
		}
	} else parts.push(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4e3));
	return {
		text: parts.join("\n\n").slice(0, 14e3),
		titleHint,
		extras: []
	};
}
async function ingestUrl(raw) {
	const url = await assertPublicHttpUrl(raw);
	const host = url.hostname.replace(/^www\./, "");
	const path = url.pathname.toLowerCase();
	if ((host === "youtube.com" || host === "m.youtube.com") && (path.startsWith("/@") || path.startsWith("/channel/") || path.startsWith("/c/") || path.startsWith("/user/") || path.endsWith("/videos") || path.endsWith("/streams"))) return ingestYoutubeChannel(url);
	const res = await fetchPublicHttp(url);
	if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
	const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
	const buf = new Uint8Array(await res.arrayBuffer());
	if (ctype.includes("pdf") || path.endsWith(".pdf")) {
		const pdf = await extractPdfBetter(buf);
		if (pdf.needsOcr || pdf.text.length < 40) throw new Error("PDF had no extractable text");
		return {
			text: `PDF ${url.toString()}\n\n${pdf.text.slice(0, 4e4)}`,
			titleHint: url.pathname.split("/").pop() ?? "pdf",
			extras: []
		};
	}
	const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
	if (ctype.includes("xml") || ctype.includes("rss") || ctype.includes("atom") || /\/(rss|atom|feed)(\.xml)?$/i.test(path)) {
		const text = parseRssItems(body).map((it) => `${it.title}\n${it.link}\n${it.summary}`).join("\n\n").slice(0, 14e3);
		if (text.length < 40) throw new Error("Feed had almost no readable text");
		return {
			text: `RSS ${url.toString()}\n\n${text}`,
			titleHint: url.hostname,
			extras: []
		};
	}
	const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const titleHint = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 140) : url.hostname;
	const text = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 14e3);
	if (text.length < 40) throw new Error("Page had almost no readable text");
	const extras = discoverDocLinks(body, url);
	const alt = body.match(/rel=["']alternate["'][^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)/i);
	if (alt?.[2]) try {
		extras.unshift(new URL(alt[2], url).toString());
	} catch {}
	return {
		text,
		titleHint,
		extras
	};
}
var TopicSchema = _enum(TOPICS);
var ScanLeadSchema = object({
	headline: string().min(1).max(180),
	why: string().max(800).optional().default(""),
	topic: TopicSchema.optional().default("council"),
	source_urls: array(string()).max(16).optional().default([]),
	evidence: string().max(2e3).optional().default(""),
	newsworthiness: number().min(0).max(20).optional().default(0)
});
var ScanResultSchema = object({
	editor_summary: string().max(2e3).optional().default(""),
	leads: array(ScanLeadSchema).max(8).optional().default([]),
	proposed_sources: array(object({
		url: string().max(500),
		title: string().max(200).optional().default(""),
		why: string().max(400).optional().default("")
	})).max(12).optional().default([])
});
object({
	headline: string().min(1).max(240),
	dek: string().max(400).optional().default(""),
	body: string().min(1).max(2e4),
	topic: TopicSchema.optional().default("council"),
	source_urls: array(string()).max(16).optional().default([]),
	integrity_notes: string().max(2e3).optional().default(""),
	memory_entities: array(string().max(80)).max(16).optional().default([])
});
/**
* Keep reachable public http(s) URLs. Drop javascript/file/SSRF literals.
* Do not filter by the watch-list origin. Discovery is the point.
*/
function sanitizePublicUrls(urls) {
	if (!Array.isArray(urls)) return [];
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const raw of urls) {
		if (typeof raw !== "string") continue;
		try {
			const s = assertHttpUrl(raw.trim()).toString();
			if (seen.has(s)) continue;
			seen.add(s);
			out.push(s);
		} catch {}
	}
	return out;
}
//#endregion
export { audit as a, classifyFetchedPage as c, ingestDocument as d, ingestUrl as f, withRetry as g, sha256 as h, assertRate as i, classifySearchHtml as l, sanitizePublicUrls as m, ScanResultSchema as n, canonicalPublicUrl as o, mapLimit as p, assertHttpUrl as r, chunksFromEvidence as s, ARCHIVE_TEXT_CAP as t, fetchPublicHttp as u };
