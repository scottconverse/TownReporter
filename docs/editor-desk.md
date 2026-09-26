# Editor desk: current workflow

For [TownReporter 0.6.68](releases/0.6.68.md). The sidebar contains Desk, Sources, Scan, Queue, Published, Opinion, Server and Stats. New story opens document intake. Dark Desk opens investigations; the TownReporter logo, breadcrumb and Public news page control return to the public newspaper. The public header’s labeled Editor’s desk button opens this workspace on desktop and phones. On narrow desk screens, open the navigation menu.

## Start with evidence

For reporting, choose New story. For an editorial, choose Opinion. Both use the same **Start with your documents** intake. Select **Add documents** or drag files into the drop area. Use the source-text field for long pasted material and the separate instruction field for the angle or assignment. A short subject is also supported.

You can attach up to 20 files, each up to 100 MB. Supported intake includes Markdown and text, Word DOC/DOCX, PDFs, images and subtitle files. PDFs and images can use OCR. Extracted text over 20 million characters must be split into volumes. The app retains originals and extracted text privately, reads long documents in sections, and reports extraction errors. Wait for attachment progress to finish before writing.

URL intake supports web pages, PDFs and YouTube transcripts where available. A URL does not guarantee that the host will supply its contents or captions. An inaccessible or unsupported source must be replaced with an accessible source or uploaded document.

Choose the writing model and research scope, then start writing. Opinion defaults to Codex Sol. Automatic tries Codex Sol, then Claude Sonnet if needed. A named choice remains the requested first runtime; a recognized technical failure may move only the unfinished call and records the requested and actual model and effort. A content refusal is final. Local model and saved API connections follow the same first-choice rule and their configured capabilities. Subscription writers receive the full configured voice and retain their research tools. Unattended ladders put Claude last and use Sonnet; Opus is an explicit editor choice only.

## Find the result

The composer shows running status and an **Open your story** link when a story has been filed. **Your recent drafts** retains links after navigation or reload. Queue opens the story workbench. Opinion lists each request with its status; a finished request opens its editorial workbench. Nothing in these writing actions publishes the piece.

If Opinion fails, use **Restore saved material** on its request to recover the source and assignment. Quota, timeout, invalid output and provider refusal are different failures; read the actual final message before retrying. Refusals are not filed as drafts. A saved partial result remains a draft requiring review.

## Review and publish

Use the story workspace's Checks, Sources and Reporting tabs beside the writing surface. Save edits before **Check draft against evidence**. That check uses saved web captures and retained documents. Its progress card names the model and current stage. When it finishes, **Evidence check results** compares the previous and checked versions side by side and keeps every verification finding visible. Keep the checked version or restore the previous version as unsaved text. Incomplete checks preserve the existing draft; changes made while checking prevent a stale replacement.

Names and spellings are checked against opened written evidence. Supported corrections are applied. A name marked **needs review** has not been established by those sources; captions and OCR are not spelling authorities. Changing the text can make previous checks stale.

Opinion must contain **Claims and sources**. Missing or unusable appendix material is an explicit review problem and blocks publication until repaired. The private fact sheet and image prompt do not print. Review sources, names, quotations and the preview, then press **Publish in \<Section\>** — the button names the section the story prints under and confirms it in the same press, so there is no separate Confirm step. When the desk could not place the story, the button is disabled and says **pick the section** until you choose one. Published stories appear on the public paper and under Published.

See the [complete editor guide](editor.md) for Sources, Scan, investigations, settings, routine notices and Stats.

## The story's words are yours

Three things on the story page are the editor's, and 0.6.67 made the desk behave as if they are.

The **headline** sits in a box with a visible edge and a small **Edit** hint. A **Redraft** will not replace a headline you have changed: the desk keeps the model's own headline separately and remembers who decided, so your words stay and the model's new attempt is filed beside them. **Use the lead's headline** puts back the line the scan filed the lead under; **Suggest headlines** asks the story model for three options and applies one only when you click it. A story that has already printed can be re-headed too — on its story page, or with **Edit headline** on the Published page. The URL never changes, so no link breaks, and the desk keeps the old headline, your account and the time.

A long **to-do** the desk wrote for itself is shortened at a word boundary, and a to-do stored by an earlier version can always be saved back. If the notes themselves fail to save, that is one plain sentence and the story still saves and prints: your notes are never the reason a valid draft stays off the paper.

**Publish in \<Section\>** records your confirmation of that section for the exact version being printed, then publishes. The server refuses a draft whose section nobody confirmed for that version, and refuses a section that is not the draft's own rather than printing the wrong one. When the scanner placed no section, the button is disabled and the reason is printed beside it. A section that differed from the scanner's is logged and counted on Stats under **Section chosen by hand**.

## 0.6.52 behavior

The model row includes the model-specific effort values that the selected Codex or Claude runtime accepts. A named choice or Automatic is recorded as the first runtime. A technical failure can be retried on a ready runtime and records the requested and actual model and effort; a provider refusal is final and creates no replacement draft.

In Queue, a completed batch offers **Redraft**. Choose a runtime again and create a new reviewable draft; it does not publish. In Server, the owner may edit Daily scan time, model, allowed effort, selected accepted sources and a limit from 1 through 12. Daily scans file leads only.

For uploaded Story and Opinion packets, all readable PDF pages are retained through the 20-million-character document-text limit. Generic captures and Dark Desk scanned-image OCR start with a bounded batch; **Read entire PDF** saves consecutive batches of up to 12 pages and resumes from retained page chunks after interruption. Failed or oversized pages remain explicitly unread. See [the release guide](releases/0.6.52.md) for current limits and evidence boundaries.
