# Changelog

## 0.2.1 — 2026-08-26

Evidence hardening on the path from capture → reporting → story → proof. Dark Desk engine unchanged.

- Paragraph collapse requires near-equivalence. A richer paragraph with new numbers, names, dates, quotes or consequences is kept.
- Rewrite detection is near-verbatim n-gram reuse of the announcing source, not bag-of-words overlap with the evidence. Grounded reporting is not auto-downgraded to a brief.
- Reported stories run four research lanes before writing: context/precedent, stakeholders/impact, alternative/contradiction, gap filling. Briefs skip extra lanes.
- The writer is fed retrieved evidence chunks (cost, dates, amendments, contradictions), not only document prefixes. Context limits belong in retrieval.
- Provenance merges field-by-field. Capture timestamps/version IDs win forensically; blank capture rows do not wipe title, organization, date or role.
- Public captured-version and compare-versions routes. Only records already cited in a published story are visible.
- “What TownReporter found” is a structured finding. The public module renders only when source URLs or version IDs resolve against published provenance.
- Worth a Look is open-ended: every open/reopened frontier item is eligible. Known patterns get ranking bonuses. Ranking is not a gate.
- First signed-in user remains owner. A second identity is not auto-granted editor.

## 0.2.0 — 2026-08-26


The public record is only the beginning. Stories are researched before they are written. Dark Desk opens on things worth examining.

- Drafting is a reporting pass, not a rewrite of the announcing source. Research follows attachments, named records, and prior meetings; consecutive restatements and empty AI filler are stripped; a rewrite is cut to a civic brief.
- Reader-facing provenance: source title, organization, document date, exact URL, capture time. Homepages are not stand-ins for documents. Disappeared sources say so. Multiple versions: Compare versions. Distinctive finds: What TownReporter found.
- Paper positioning: independent civic reporting for Longmont; “Civic news, human-edited” is supporting trust language. About and How we report describe watch → detect → follow → preserve → investigate → write, then a human gate.
- Dark Desk is an investigative desk UI. Worth a look ranks missing reports, disappeared records, monitor alerts, reopened trails, open promises, and high-newsworthiness leads. Three starts: Find something to dig into, Investigate a lead, Keep digging. Investigation view: what we know / testing / found / trail / open questions / leads / dead ends / evidence. The investigative engine is unchanged.

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
