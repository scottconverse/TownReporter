# Four workflows — owner's product spec (2026-09-05)

Each workflow must answer three questions clearly on every screen: what am I asking the system to do, what happened, and what do I do next. These are proposed behaviors, not existing features.

## 1. Manual Dark Desk page watching
Purpose: let the editor say "this particular page matters; tell me when something meaningful changes" (a development application, school boundary proposal, nonprofit service page, venue schedule, employer announcement). A source helps discover stories; a watched page helps follow an ongoing question.

Flow: (1) From Dark Desk or an investigation, click "Watch a page". (2) Enter URL, short name, why you are watching it. (3) Optionally attach to an investigation. (4) System makes a first capture and confirms "Watching this page. First capture saved." with "Open watch". (5) Later checks create a change entry when content changes.

Watch detail shows: last successful check + next scheduled check; current captured version; previous versions and a readable comparison; any access problem (blocked, moved, unavailable, unable to extract useful text); Pause, Resume, Stop watching, Open original.

When a change arrives: Read the change, Add it to an investigation, Create a lead, Dismiss.
Key distinction: "We checked and nothing changed" must look different from "We couldn't check." A changed page is evidence to inspect, not automatically a story.

## 2. Legal removal with an audit and backup trail
Purpose: a removal that bypasses ordinary recoverable trash and makes the remaining cleanup visible. Normal delete = off the paper but recoverable. Legal removal = controlled removal + track where copies remain.

Flow: (1) Open a published story, choose "Legal removal" from a clearly separate menu. (2) Show the exact story and what the operation will remove. (3) Require a reason and explicit confirmation. (4) Remove the public story and the relevant recoverable application copies. (5) Create a restricted removal record: who, when, why, what was removed. (6) Show known backups that may still contain the content.

Result distinguishes: Public removal complete · Application cleanup complete/incomplete · Backup cleanup pending · Operator review complete. On the travel machine a pending item reads: "Public removal completed. Backup cleanup requires the Halo operator," with a concrete operator checklist.
Key distinction: removing a public page does not prove every copy is gone; the audit record must not preserve the whole removed article; the interface records the retain/remove policy decision rather than implying one button equals legal compliance.

## 3. Configurable newspaper sections
Purpose: the paper reflects the community actually covered, not a fixed government topic list. EXAMPLE sections (owner's list is still the required decision): Neighborhoods, Schools & Families, Business & Work, Arts & Culture, Outdoors, Community Organizations, Government, Opinion.

Part 1 — organize the newspaper (Paper setup → Sections): add/rename sections; short description; order in navigation; hide or retire; article count per section; move existing articles when retiring. Preview what readers will see before applying navigation changes. Renaming/retiring must have a clear plan for existing articles and links.
Part 2 — direct the reporting: each section has sources for its subject; a short reporting brief; scanner instructions; examples of useful leads and material to ignore. E.g. Business & Work looks beyond official economic-development releases toward workers, independent shops, openings/closures, everyday livelihoods.
Key distinction: adding "Arts & Culture" to the masthead does not create arts coverage; discovery and editorial workflows must support the section too.

## 4. The fuller investigative workflow
Purpose: Dark Desk pursues and tests a question while the editor controls what becomes a publishable claim. A carefully limited research toolset and a stronger verification process; older methods need evaluation before adoption.

Steps: (1) Define the question: tip, why it matters, working hypothesis, and an ordinary explanation for the same facts. (2) Set boundaries: geographic scope, research depth, spending/time limit, with plain explanations. (3) Investigate: search, open sources, follow document references, capture evidence through controlled tools; show what it is doing and why, not just a spinner. (4) Maintain the case file: separate lists of findings, supporting records, contradictions, unanswered questions, people who still need to respond. (5) Challenge the case: a distinct verification pass — try to disprove the hypothesis, check whether independent sources repeat one another, examine missing context, test whether the investigation introduced unsupported assumptions. (6) Editorial decision: Continue researching · Seek a response · Wait and watch · Close with no finding · Send to the reporting queue.
The handoff to the Queue includes evidence and uncertainties, not just a headline. Publication remains an editorial decision.
Key distinction: deeper research must not produce more confident prose; it produces a better-supported explanation or an honest conclusion that the evidence does not establish the suspected story.

Prototype rule: each workflow is a complete clickable scenario including its failure or waiting state.
