# Live image-only PDF OCR proof (2026-09-17)

**Environment:** isolated build on `http://127.0.0.1:4400`, database `townreporter_dark_live_20260916`, signed-in test owner. Production was not touched.

**Fixture:** a one-page PDF was generated locally from a rendered image with no text layer. It contained the text `CITY OF LONGMONT`, `BUDGET OFFICE NOTICE`, `The adopted 2026 budget is $123,456,789.`, and `Public hearing date: July 15, 2026.` The fixture was uploaded through the real Desk **Write a story** document picker and drafted with `codex-luna` / `gpt-5.6-luna`.

**Result:** the isolated story recorded:

`image-only-budget-notice.pdf · read · 1/1 parts read`

`Read all 208 characters in 1 parts across 1 pages. Original and extracted text retained.`

No browser console or page errors were recorded.

**What this proves:** the real selected-model ingestion path can render and OCR a one-page image-only PDF, retain the original and extracted text, mark the page read, and expose the document in the Story Sources list.

**What this does not prove:** real scanned-packet quality, multi-page or partial-read behavior, OCR accuracy on poor or rotated scans, table fidelity, or that every OCR fact is used in the generated draft. In this run the generated draft did not surface the fixture's date or budget amount; it used unrelated retained public captures. The OCR ingestion result is the evidence here, not the draft's selection behavior.

_Later on 2026-09-17 this was extended: a real published Longmont council packet (258 pages) was ingested through the same picker for honest partial-read reporting, and pages 1-2 of that real packet were rasterized into an image-only PDF and read by the vision path. See [real council packet ingestion](real-council-packet-ingestion-0651.md) and [real-content image OCR](real-content-image-pdf-ocr-0651.md). Those remain bounded exercises, not paper-scan acceptance._
