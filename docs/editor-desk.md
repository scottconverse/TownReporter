# Editor desk: current workflow

For [TownReporter 0.6.87](releases/0.6.87.md). This page is the short version: the desk in one pass, the way an editor uses it. The screen-by-screen tour is [Part 2 of the manual](manual.md#part-2--the-desk-screen-by-screen); the longer working guide is the [editor’s manual](editor.md).

## The desk at a glance

The navigation on the left has eleven links: **Today**, **Queue**, **Drafts**, **Published**, **Opinion**, **Follow-ups**, **Dark Desk**, **Sources & scan**, **Models**, **Server** and **Stats**. Counts show beside Queue (open leads), Drafts, Opinion, Follow-ups and Dark Desk. **Scan history**, **Import**, **Beat memory** and **Legal removals** are not in the navigation but are found with **Ctrl+K** search. **View the paper ↗**, the **Dark / Light** button and the **Aa Large** button are at the foot of the navigation. On a phone the navigation is the **Menu** button. The TownReporter name and **View the paper ↗** return to the public paper.

The app warns and never blocks. When something looks risky, a box titled **Before you continue** (or a message in the corner) says so and offers an “anyway” button, such as **Draft this story anyway**, **Kill anyway** or **Publish anyway in <Section>**. Cancelling changes nothing, and every “anyway” is recorded with your name.

## Start with evidence

For reporting, press **+ New story** on Today. For an editorial, open **Opinion**. In **New story**, the tab **AI drafts from material** takes documents (**Drop documents here** or **Choose files**), links, pasted text and an **Assignment**. Up to 20 files, 100 MB each. The desk reads PDF, Word, Excel, PowerPoint, LibreOffice, Markdown and text, images and scans (with OCR), CSV and subtitle files. Text over 20 million characters per document must be split into volumes. The app keeps originals and extracted text privately, reads long documents in sections and reports errors. A web address does not guarantee the host will hand over its contents or captions; if one is blocked, replace it with an uploaded document. The other tabs are **Write it myself** and **Paste a finished story**. Opinion uses the same document intake under **Start with your documents**.

Choose a **Research scope**: **Research public sources**, or **Use only supplied material** (reads your text and files, searches nothing and opens no other pages). Choose the writing model and press **Start drafting**.

**The model.** Every AI button uses the same picker: Automatic, the named Codex, Gemini, Claude and DeepSeek models, a Local model, and any saved API connection. Automatic tries **DeepSeek v4.1 Flash 1017**, then a model already loaded on this computer, then **Codex Sol 6.1 (balanced)**, then **Claude Sonnet 5.5**. Gemini is a named pick, not part of Automatic. Opinion’s Automatic is shorter: DeepSeek v4.1 Flash 1017, Codex Sol 6.1, then Claude Sonnet 5.5. A named choice is tried first. A technical failure (a usage limit, a lapsed sign-in, an outage or a timeout) moves only the unfinished call to the next ready model, and the desk records the move and says why. A content refusal is final and is not filed as a draft. The writing models, their sign-ins and their time limits are on **Models** and **Server → Time budgets**.

## Find the result

A running draft appears in the **Running** box in the navigation and under **Running now** on Today, with **Open your story**. Drafts you have started sit under **In progress** on Today and on the **Drafts** screen. Each Drafts row has a status chip and one button: **Watch**, **Retry**, **Check**, **Start story** or **Review**. Nothing in these actions publishes the piece.

If an Opinion request fails, use **Restore saved material** on its row to put the subject and instruction back in the form. Quota, timeout, invalid output and refusal are different failures; read the message before retrying. A refusal is not filed as a draft. A saved partial result is a draft that needs review.

## Review and publish

On the story page, the **Checks**, **Sources** and **Reporting** tabs sit beside the writing surface. Save edits, then press **Check draft against evidence** to compare the draft with saved web pages and your documents. A card names the model and the stage. The checked version is a new saved draft; **Compare versions** shows both side by side and you can **Keep checked version** or **Restore previous**. An incomplete check keeps your draft and says why. **Find evidence** on the Sources tab searches saved evidence by exact words and by meaning, and lists past stories close in meaning. It is on the editor desk only.

Names and spellings are checked against written sources. A name marked “needs review” has not been established; captions and OCR are not spelling authorities.

When the draft is ready, press **Publish in <Section>**. The button names the section the story prints under, and pressing it opens a confirmation. If the desk could not place the story, the button reads **No section chosen. Pick one, or publish in <Section> anyway.** and a second button, **Publish anyway in <Section> (no section was chosen)**, publishes at once. A **Before you can publish** list shows each warning with a button that clears it or, where it fits, an “anyway” press. Only an empty headline, an empty story, a publish already running, an evidence decision still saving and a lead the desk can no longer find turn the button off. Opinion must contain **Claims and sources**; if it does not, the piece warns and the button reads **Publish anyway — I accept these claims are unreviewed**. The private fact sheet and image prompt do not print.

Published stories appear on the public paper and under **Published**. To correct one, use **More ▾ → Post correction**. See the [complete editor guide](editor.md) for Sources, Scan, Dark Desk, settings, routine notices and Stats.

## The story’s words are yours

Three things on the story page belong to the editor.

The **headline** sits in a box with a visible edge and a small **Edit** hint. A redraft will not replace a headline you have changed. **Use the lead’s headline** puts back the line the scan filed the lead under, and **Suggest headlines** asks the story model for three options and applies one only when you press **Use this headline**. A story that has already printed can be re-headed on its story page (**Save headline**) or with **Edit headline** on Published. The address never changes, so no link breaks, and the desk keeps the old headline, your account and the time. No correction is posted for a headline change.

A long to-do the desk wrote for itself is shortened at a word boundary. If the reporting notes fail to save, that is one plain sentence and the story still saves and prints.

**Publish in <Section>** confirms the section for the exact version being printed. A section that differed from the scanner’s choice is logged and counted on Stats under **Section chosen by hand**.

## Models, effort and long documents

The model picker shows only the thinking-effort levels the chosen model supports. DeepSeek v4.1 Flash 1017 always starts at None. The chosen model and effort are saved with the job, so a failover records both the model asked for and the model that ran. In the Queue, a finished batch offers **Redraft**, which creates a new reviewable draft. On **Server → Daily scan** the owner sets the daily time, model, effort, a **Daily priority set** and **Read every day**, and the accepted sources. Scheduled scans file leads only.

For uploaded Story and Opinion packets, all readable PDF pages are kept up to the 20-million-character limit. In Dark Desk, **Read entire PDF** reads a retained PDF in batches of up to 12 pages, saves each batch and lists which pages are still unread. Failed or oversized pages stay marked unread. A partial read is never reported as complete.
