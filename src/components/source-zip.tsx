import { SOURCE_ZIP_BACKUP, SOURCE_ZIP_URL } from "@/lib/source-zip-url";

/**
 * The download link, as an actual link.
 *
 * Both of these carried `href="/get-the-code"` with the real address reachable
 * only from an onClick handler, and a comment explaining that this kept a
 * preview environment from navigating to a zip. That environment was the app
 * builder this project was scaffolded in; it is not this newspaper's problem,
 * and the cost was paid by readers. A gate audit found the effect: on
 * `/get-the-code` the download button linked to the page it was already on, so
 * clicking it appeared to do nothing, and the only way to actually get the
 * source was to copy the plain-text address printed underneath.
 *
 * Everything a link is supposed to do came back with the href: the status bar
 * shows where it goes, middle-click and ctrl-click open a tab, right-click can
 * copy the address, a keyboard reaches it, and it still works if the script
 * never runs. A handler that calls preventDefault on every click has none of
 * that, and on a page whose entire purpose is "here is the code, take it", the
 * link IS the feature.
 *
 * `rel="noopener noreferrer"` because the target is another origin, and
 * `target="_blank"` so a reader downloading the source does not lose the paper
 * they were reading.
 */
export function SourceZipButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <a href={SOURCE_ZIP_URL} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/**
 * The fallback, for the window between tagging a release and the tag existing.
 *
 * `SOURCE_ZIP_URL` names the current version's tag, which is correct and is
 * enforced by a test -- but a tag that has not been cut yet is a 404. This
 * points at the branch archive, which always exists.
 */
export function SourceZipBackupLink({ className }: { className?: string }) {
  return (
    <a href={SOURCE_ZIP_BACKUP} className={className} target="_blank" rel="noopener noreferrer">
      Backup link
    </a>
  );
}

/**
 * The address in plain text, selectable in one click.
 *
 * Kept even though the button is now a real link. Someone reading over a
 * shoulder, or on a machine where the browser cannot open a new tab, or
 * writing the address down for another machine entirely, needs to SEE it.
 * `user-select: all` makes one click take the whole thing.
 */
export function SourceZipUrl() {
  return (
    <code
      className="block break-all text-sm"
      style={{ wordBreak: "break-all", userSelect: "all" }}
    >
      {SOURCE_ZIP_URL}
    </code>
  );
}
