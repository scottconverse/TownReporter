/*
  WHAT A TAKEDOWN SAYS WHEN IT LANDS (FB7, item 5, A2c X1).

  "The takedown success toast never says whether the public link was kept (it
  was)."

  The server had answered the question all along -- `TakeDownCaptureResult`
  carries `linkKept`, and the checkbox that decides it sits on the same form
  ("Remove the link to the original too. Left unticked, the public notice keeps
  the link.") -- but the success sentence was one string whatever the editor had
  ticked, so the one fact the press turns on was the one thing it did not say.
  A2c measured it: the link WAS kept, and the editor had to go and look.

  Pulled out of the component so the wording is testable without a React tree,
  and so the two arms cannot drift back into one.
*/

/** The sentence shown after a capture is taken down. */
export function takedownDoneNotice(linkKept: boolean): string {
  return (
    "Excerpt taken down. The stored text and any original file for this capture are " +
    "emptied, the audit trail records why, and the public page now says the publisher " +
    "asked. " +
    // The two arms are worded to match the checkbox that chose between them, so
    // the editor can read the answer against the question they were asked.
    (linkKept
      ? "The public notice keeps the link to the original."
      : "The link to the original was removed too.") +
    " There is no restore."
  );
}

/** The sentence shown when the takedown did NOT land. Says what did not happen. */
export function takedownFailedNotice(): string {
  return "The takedown could not be completed. Nothing was removed.";
}
