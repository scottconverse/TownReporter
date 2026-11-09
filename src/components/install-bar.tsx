import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { usePaper } from "@/lib/paper-context-state";
import { promptInstall, rememberInstallBarClosed, useInstallBarMode } from "@/lib/app-install";

/**
 * The Safari share glyph: a square with an arrow leaving the top.
 *
 * Safari's install instruction is "tap the Share button", and on a phone the
 * reader is looking for a small icon in a toolbar, not a word. Drawing it here
 * costs one inline SVG and no request.
 */
export function ShareIcon() {
  return (
    <svg
      className="install-share-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 16V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

/**
 * The big install button. Same element on the story-page bar and on
 * /get-the-app: both replay the prompt Chrome saved before the page mounted.
 */
export function InstallButton({ onInstalled }: { onInstalled?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="install-bar-install"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const outcome = await promptInstall();
          // "unavailable": the browser had nothing to show, so leave the
          // button where it is rather than pretending something happened.
          if (outcome !== "unavailable") onInstalled?.();
        } finally {
          setBusy(false);
        }
      }}
    >
      Install
    </button>
  );
}

/**
 * "Get {paper} on your phone", at the top of a story, on a phone only.
 *
 * It shows once and then stays out of the reader's way: installed, dismissed,
 * or already run from the home screen, it renders nothing. Anything else on a
 * phone gets either the Install button or the two taps their browser actually
 * needs, plus a link to the full steps.
 */
export function InstallBar() {
  const PAPER = usePaper();
  const { mounted, mode } = useInstallBarMode();
  const [dismissed, setDismissed] = useState(false);

  if (!mounted || dismissed || mode === "none") return null;

  const close = () => {
    setDismissed(true);
    rememberInstallBarClosed();
  };

  return (
    <aside className="install-bar" aria-label={`Get ${PAPER.name} on your phone`}>
      <p className="install-bar-head">Get {PAPER.name} on your phone</p>
      <button type="button" className="install-bar-close" aria-label="Close" onClick={close}>
        <span aria-hidden="true">×</span>
      </button>
      {mode === "install" ? (
        <div className="install-bar-body">
          <InstallButton onInstalled={() => setDismissed(true)} />
        </div>
      ) : null}
      {mode === "ios-steps" ? (
        <div className="install-bar-body">
          <p className="install-bar-step">
            <span className="install-bar-stepnumber" aria-hidden="true">
              1.
            </span>
            Tap the Share button <ShareIcon />
          </p>
          <p className="install-bar-step">
            <span className="install-bar-stepnumber" aria-hidden="true">
              2.
            </span>
            Tap <strong>“Add to Home Screen”</strong>
          </p>
          <Link className="install-bar-link" to="/get-the-app">
            See all steps
          </Link>
        </div>
      ) : null}
      {mode === "android-steps" ? (
        <div className="install-bar-body">
          <p className="install-bar-step">Add it to your home screen from your browser menu.</p>
          <Link className="install-bar-link" to="/get-the-app">
            See how
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
