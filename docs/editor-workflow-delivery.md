# Queue and draft workflow

**Development candidate — NOT YET DEPLOYED.** These controls are present in
the development tree and remain subject to deployment and operator acceptance.
They do not replace the existing model pickers, queue actions, evidence review,
or publication gate. This guide describes workflow behavior, not a claim that
AI reporting quality has passed.

## Repeated and possible-duplicate leads

The queue may show a lead with **seen again ×N**. This means a later Scan found
a strong match to an existing eligible lead; the existing lead is stamped with
the resurfacing count instead of a duplicate row being filed.

A weaker match is filed as a separate lead with **Possible duplicate · compare**.
Open that link to compare it with the earlier lead. A possible match to a
killed lead is shown **Held for review**; the editor decides what to do. If the
earlier row is unavailable, the queue shows **Possible duplicate · unavailable**
and does not pretend the comparison was completed. These labels are signals for
editor review, not automatic merges or publication decisions.

## Drafting one lead or a selected batch

On an eligible queue lead, choose the existing writing model in its picker and
select **Draft with AI** (or **Redraft with AI** for an existing draft). The
queue confirms **Draft queued with …**; open the lead to watch the workbench.
The selected model remains the model for that explicit run according to its
normal picker behavior.

For several eligible leads, use **Draft selected leads**. Select up to five,
choose a **Batch runtime**, and select **Draft selected**. A batch queues drafts
for editor review; it does not publish anything. The results identify each
lead, show its status, and provide **Open current story workbench: …**. A
completed item reports **Batch saved draft #N**. If its evidence check was
incomplete, the result says so and directs the editor to review the current
draft before publication. A batch result is not a publication approval.

## Saved drafts, checkpoints, and checking evidence

The expensive writer pass saves an intermediate draft checkpoint before later
evidence work finishes. This means a useful draft can remain available after a
restart, timeout, or incomplete follow-up. The saved draft is still an editor
working copy: inspect and edit it, and do not confuse “draft saved” with
“evidence checked” or “published.” Original saved versions are retained when a
checked result creates a newer version.

On the story workbench:

1. Select **Save edits** before checking. Unsaved text cannot be checked.
2. Choose the model in the existing picker and select **Check draft against
   evidence**. The queued check uses the current saved draft and its captured
   evidence; it does not restart discovery or the initial writing pass.
3. While queued or running, wait for the status shown by the workbench. A
   failed check leaves the saved draft available and reports the failure.
4. When the check finishes, review the result. A complete check can offer
   **Reload checked draft**. If the checked version is no longer current, the
   control instead says **Load checked version for review**; loading it is an
   explicit editor choice.

If no matching saved capture is available, the workbench says the check was
incomplete and keeps the draft marked for review. Reconciliation can edit or
remove unsupported assertions only from the supplied saved evidence; it does
not silently invent evidence. Publication remains separate: the editor must
review the draft and use the existing **Publish to the paper** confirmation.

The feature is intentionally conservative about concurrent edits. Save the
current draft before checking, and review any stale-version message before
loading a result. A checkpoint, a completed evidence check, and a printed
article are three different states.
