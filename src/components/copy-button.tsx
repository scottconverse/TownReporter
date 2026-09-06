/*
  Owner-requested (0.6.22): a Copy button for the two extracted blocks on the
  Opinion desk's open-piece view (the image prompt and the editor's fact
  sheet) -- text that is parsed out of a pasted piece by editorial.ts and
  never printed, so an editor's only way to move it anywhere else used to be
  a manual select-and-copy inside a `max-h` scrolling `<pre>`.

  Dependency-free by design (the task's own constraint) and shared by both
  call sites so they can't drift: one clipboard write, one label swap, one
  failure message. Never a silent no-op -- a denied permission, an older
  browser, or a non-secure context all land on the same one-line notice
  rather than a button that visibly does nothing.
*/
import { useEffect, useRef, useState } from "react";
import { InkButton, announceToDesk } from "@/components/desk-chrome";
import {
  COPIED_LABEL_MS,
  COPY_FAILURE_MESSAGE,
  copyButtonLabel,
} from "@/components/copy-button-copy";

export function CopyButton({
  text,
  announceText,
}: {
  /** The text to copy. Empty (or all-whitespace) renders nothing -- there is
   * nothing here to copy, and a button that copies "" is worse than no
   * button. */
  text: string;
  /** Spoken through the desk's live region (announceToDesk) on a successful
   * copy, e.g. "Fact sheet copied." */
  announceText: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  if (!text.trim()) return null;

  async function handleClick() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard API");
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
      announceToDesk(announceText);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPIED_LABEL_MS);
    } catch {
      // Older browser, denied permission, or a non-secure context: say so in
      // words next to the button rather than leaving a click that did nothing.
      setFailed(true);
      setCopied(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <InkButton tone="quiet" small onClick={() => void handleClick()}>
        {copyButtonLabel(copied)}
      </InkButton>
      {failed ? <span className="text-sm text-rust">{COPY_FAILURE_MESSAGE}</span> : null}
    </span>
  );
}
