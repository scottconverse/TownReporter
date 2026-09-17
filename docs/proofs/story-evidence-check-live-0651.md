# Live Story evidence-check proof (2026-09-17)

**Environment:** isolated build on `http://127.0.0.1:4400`, database `townreporter_dark_live_20260916`, signed-in test owner `darkdesk+longmont@townreporter.test`. Production was not touched.

**Run:** one Story draft and one evidence check through the built UI.

- Model: `codex-luna` / `gpt-5.6-luna`.
- Uploaded document: `evidence-check-source-1789625893203.txt`, 100 bytes:
  `Official meeting record: The City Council approved the 2026 budget on July 15, 2026, by a 6-1 vote.`
- Draft body before check: `The City Council approved the 2026 budget July 15, 2026, by a 6-1 vote, according to the meeting record.`
- Evidence check result: **finished**, with the checked saved draft loaded and **1 change proposed**.
- Checked version: `The City Council approved the 2026 budget on July 15, 2026, by a 6-1 vote (evidence-check-source-1789625893203.txt, chars. 1-100).`
- The UI kept the editor decision explicit: **Keep checked version**, **Restore previous version**, and **Publish to the paper** remained separate actions.
- The UI warned that the supplied excerpt did not identify the city, budget amount or contents, or the dissenting council member. It also said that the source check could not connect the draft's factual claims to exact passages in saved public sources, while the uploaded passage was verified.
- No browser console or page errors were recorded.
- Screenshot: `work/dark-live/live-story-evidence-check-resume.png` (outside the repository).

**What this proves:** the real provider path can queue a Story draft against an uploaded document, run `Check draft against evidence`, validate a passage against the retained uploaded text, load a checked version, and preserve the before/after editor decision.

**What this does not prove:** accuracy or completeness beyond the one 100-byte record; behavior with PDFs, OCR, large packets, multiple documents, or a real contradiction across independent sources; that every factual claim in a model-written draft is covered; or any production deployment.
