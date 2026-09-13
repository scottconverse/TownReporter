# Editor desk: current workflow

For [TownReporter 0.6.44](releases/0.6.44.md). The sidebar contains Desk, Sources, Scan, Queue, Published, Opinion, Server and Stats. New story opens document intake. Dark Desk opens investigations; the TownReporter logo, breadcrumb and Public news page control return to the public newspaper. On narrow screens, open the navigation menu.

## Start with evidence

For reporting, choose New story. For an editorial, choose Opinion. Both use the same **Start with your documents** intake. Select **Add documents** or drag files into the drop area. Use the source-text field for long pasted material and the separate instruction field for the angle or assignment. A short subject is also supported.

You can attach up to 20 files, each up to 100 MB. Supported intake includes Markdown and text, Word DOC/DOCX, PDFs, images and subtitle files. PDFs and images can use OCR. Extracted text over 20 million characters must be split into volumes. The app retains originals and extracted text privately, reads long documents in sections, and reports extraction errors. Wait for attachment progress to finish before writing.

URL intake supports web pages, PDFs and YouTube transcripts where available. A URL does not guarantee that the host will supply its contents or captions. An inaccessible or unsupported source must be replaced with an accessible source or uploaded document.

Choose the writing model and research scope, then start writing. Opinion defaults to Codex Sol. Automatic tries Claude Opus, then Sol if needed; named choices stay selected. Local model and saved API connections follow their configured capabilities. Subscription writers receive the full configured voice and retain their research tools.

## Find the result

The composer shows running status and an **Open your story** link when a story has been filed. **Your recent drafts** retains links after navigation or reload. Queue opens the story workbench. Opinion lists each request with its status; a finished request opens its editorial workbench. Nothing in these writing actions publishes the piece.

If Opinion fails, use **Restore saved material** on its request to recover the source and assignment. Quota, timeout, invalid output and provider refusal are different failures; read the actual final message before retrying. Refusals are not filed as drafts. A saved partial result remains a draft requiring review.

## Review and publish

Use the story workspace's Checks, Sources and Reporting tabs beside the writing surface. Save edits before **Check draft against evidence**. That check uses saved web captures and retained documents. Incomplete checks preserve the existing draft; changes made while checking prevent a stale replacement. Reload a checked version explicitly when offered.

Names and spellings are checked against opened written evidence. Supported corrections are applied. A name marked **needs review** has not been established by those sources; captions and OCR are not spelling authorities. Changing the text can make previous checks stale.

Opinion must contain **Claims and sources**. Missing or unusable appendix material is an explicit review problem and blocks publication until repaired. The private fact sheet and image prompt do not print. Review sources, names, quotations and the preview, then use **Publish to the paper** and its existing confirmation. Published stories appear on the public paper and under Published.

See the [complete editor guide](editor.md) for Sources, Scan, investigations, settings, routine notices and Stats.
