# Real-content image-only PDF OCR proof (2026-09-17)

**Environment:** isolated build on `http://127.0.0.1:4400`, database `townreporter_dark_live_20260916`, signed-in test owner. Production was not touched. Story `story/9`.

**Fixture:** pages 1 and 2 of the **real** published Longmont City Council Regular Session packet for 2026-01-13 (the same 258-page document as [the real council packet proof](real-council-packet-ingestion-0651.md)) were rasterized at 150 DPI and re-saved as a 2-page image-only PDF with **no text layer** (355,243 bytes; `pdftotext` returns 0 characters). This exercises the vision path on genuine civic content — real dates, a real street address, the Clerk's real phone number, real agenda headings — rather than a synthetic notice.

**How it was exercised:** uploaded through the real Desk **Write a story** document picker on the isolated build and drafted with `codex-luna` (a vision-capable model). One bounded 2-page exercise; no packet sweep.

**What the product reported:**

`real-packet-pages-1-2-image-only.pdf · read · 1/1 parts read`

Database row: `status = read`, `pages = 2`, `read_parts / total_parts = 1 / 1`, `full_text = 2,844 characters`, detail `Read all 2,844 characters in 1 parts across 2 pages. Original and extracted text retained.` No browser console or page errors. The story reached **DRAFTED** with no failure state.

**Fidelity check against ground truth.** The real packet's own text layer was used as the answer key. Every probe below was found in the OCR-derived text:

| Probe (from the real packet) | Result |
| --- | --- |
| `January 13, 2026` | found |
| `7:00` | found |
| `Kimbark` (street address) | found |
| `303-651-8649` (City Clerk) | found |
| `December 16, 2025` (minutes being approved) | found |
| `January 12-19, 2026` (MLK proclamation dates) | found |
| `Martin Luther` | found |
| `MEETING CALLED TO ORDER` | found |
| `ROLL CALL` | found |
| `APPROVAL OF MINUTES` | found |
| `CITY MANAGER` | found |
| `Ward 3` | found |
| `Rule 5` | present as a line-wrapped `Rule\n5`; my initial probe missed it only because of the wrap |

The OCR also recovered the `CITY OF LONGMONT COLORADO` wordmark from the page's logo image, which the original PDF's text layer did not contain — extra content, not a substitution.

**What this proves**

- The vision OCR path ingests a genuinely image-only PDF and extracts real civic text: meeting date, start time, venue address, Clerk phone number, the minutes date, proclamation dates and agenda headings all matched the authoritative text layer.
- The read is reported honestly and completely for a small document: `1/1 parts read`, `2` pages, character count stated, original retained.
- OCR-derived text is labelled as OCR in the retained text (`[real-packet-pages-1-2-image-only.pdf, page 1, OCR extraction]`), so the provenance is visible rather than silently presented as ordinary extraction.

**What this does not prove**

- The fixture is a **clean rasterization** of a digital page, not a paper scan. Skew, speckle, fax artifacts, handwriting, stamps, rotated pages, low DPI and poor contrast are not exercised.
- Two pages only. Multi-page OCR accuracy, large-packet OCR cost, and partial-failure reporting on a long scan are not established here.
- Table fidelity is not tested; these two cover pages contain no data tables.
- The 258-page packet exercised separately has a text layer, so it did not test OCR at all. The two proofs are complementary, not the same test.
