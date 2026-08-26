# Changelog

## 0.1.0 — 2026-08-26

First tagged release. Civic paper + editor desk for Longmont. Scan up to 200 sources. Dark Desk investigates without using uncertainty as a stop.

- Dark Desk does not gate on unknown classification, unresolved identity, missing provenance, weak sources, contradictions, or low confidence. Those states are recorded; the next hop still runs.
- Exhausted / dead-end frontier items reopen on materially new evidence. Prior status, reason, timestamp, and search history stay on the record.
- One zero-result query is not exhaustion. Remaining strategies continue. Failed providers fall through DuckDuckGo → Bing → Brave → Wikipedia.
- Hop budget pauses remaining work (`paused` + `pause_reason`). Continue digging resumes leftover URLs. Evidence exhaustion closes a path; budget does not.
- Production OCR: native PDF text, then Grok vision on embedded JPEGs, then optional tesseract.js. `needs-ocr` does not defer the lead.
- Original artifact bytes stored (`artifact_blobs`, ≤4MB).
- Source monitors tick in the background (dev interval + `GET /api/cron/monitors`). They do not wait for an editor to open Dark Desk.
- Prompt: coordination is not automatically wrongdoing. Private citizens: no drive-by dossiers; follow material public-interest trails.
- Eight non-gating regression tests plus Bing/Brave parser coverage.
