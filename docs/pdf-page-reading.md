# Read selected PDF pages

**Development candidate — NOT YET DEPLOYED.** This page-reader workflow is
implemented in the development tree. It is not a claim that TownReporter has
passed real-world transcription acceptance or that every PDF will be read
successfully.

## Use it from Dark Desk

Open a captured PDF artifact in **Dark Desk**. The original captured PDF remains
unchanged. Choose an explicit model for the page-reading action; **Automatic**
is not accepted for this action. Then enter a 1-based, inclusive page range:

- **First page** and **last page** must be whole-number page numbers.
- The range can contain no more than 12 pages.
- The first page cannot be after the last page.

Select the action to queue the read. The artifact shows the queued/running
status while the worker processes it. When it finishes, the returned transcript
is labeled with the page numbers that were requested. Review the transcript
against the original PDF before relying on it.

The transcript is stored as additional evidence alongside the original PDF and
its existing `full_text`. It does not overwrite, replace, or silently revise
the original capture. If the original PDF is missing or cannot be reopened,
the reader does not refetch it; the action fails rather than substituting a new
document.

## Provider and cost boundary

The selected model controls where the pages are sent. If the picker visibly
shows a cloud provider, the selected pages leave the TownReporter machine and
that provider's normal usage charges, retention, and privacy terms may apply.
Review the provider choice before queuing a read. A local model keeps the page
request on the configured local runtime, subject to that runtime's own
configuration.

Page reading is an evidence aid, not an automatic fact check or publication
decision. Keep the original PDF available, compare important names, numbers,
dates, and quotations to the page image, and use the existing editor review and
publication gates.
