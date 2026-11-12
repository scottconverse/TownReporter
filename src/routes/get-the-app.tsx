import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PaperShell } from "@/components/paper-chrome";
import { InstallButton, ShareIcon } from "@/components/install-bar";
import { isStandaloneNow, useInstallBarMode, useInstallPrompt } from "@/lib/app-install";
import { usePaper } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";

export const Route = createFileRoute("/get-the-app")({
  head: ({ match }) => ({
    meta: [{ title: `Get the app — ${(match.context.paper ?? DEFAULT_PAPER_IDENTITY).name}` }],
  }),
  component: GetTheApp,
});

/**
 * The steps the story-page bar points at.
 *
 * A reader who tapped "See all steps" already wants the paper on their home
 * screen, so this page asks for nothing and explains both phones in full:
 * Safari has no install prompt, so iPhone readers get the Share menu, and
 * Android readers get the browser menu for the cases where Chrome never fired
 * one. The Install button appears only where the browser has a prompt to show.
 */
function GetTheApp() {
  const PAPER = usePaper();
  const { mounted } = useInstallBarMode();
  const hasPrompt = useInstallPrompt();
  const [installed, setInstalled] = useState(false);

  // "You already have the app." is about the browser's display mode, which the
  // server cannot see; decided after mount so the HTML always matches.
  useEffect(() => {
    if (mounted) setInstalled(isStandaloneNow());
  }, [mounted]);

  return (
    <PaperShell compact>
      <div className="infopage standing-page get-app-page">
        <h1>Get the app</h1>
        <p>
          Put {PAPER.name} on your phone’s home screen. It opens like an app. No app store.
          Nothing to pay.
        </p>
        {installed ? <p className="get-app-installed">You already have the app.</p> : null}
        {mounted && hasPrompt ? (
          <div className="install-bar-body">
            <InstallButton />
          </div>
        ) : null}
        <h2>iPhone or iPad</h2>
        <ol className="howlist get-app-steps">
          <li>
            <span className="stepnumber" aria-hidden="true">
              1.
            </span>
            <div>
              <p>Open this site in Safari.</p>
            </div>
          </li>
          <li>
            <span className="stepnumber" aria-hidden="true">
              2.
            </span>
            <div>
              <p>
                Tap the Share button <ShareIcon />
              </p>
            </div>
          </li>
          <li>
            <span className="stepnumber" aria-hidden="true">
              3.
            </span>
            <div>
              <p>
                Scroll down and tap <strong>“Add to Home Screen”</strong>.
              </p>
            </div>
          </li>
          <li>
            <span className="stepnumber" aria-hidden="true">
              4.
            </span>
            <div>
              <p>
                Tap <strong>“Add”</strong>.
              </p>
            </div>
          </li>
        </ol>
        <h2>Android</h2>
        <ol className="howlist get-app-steps">
          <li>
            <span className="stepnumber" aria-hidden="true">
              1.
            </span>
            <div>
              <p>Open this site in Chrome.</p>
            </div>
          </li>
          <li>
            <span className="stepnumber" aria-hidden="true">
              2.
            </span>
            <div>
              <p>Tap the menu (three dots) at the top right.</p>
            </div>
          </li>
          <li>
            <span className="stepnumber" aria-hidden="true">
              3.
            </span>
            <div>
              <p>
                Tap <strong>“Install app”</strong> or <strong>“Add to Home screen”</strong>.
              </p>
            </div>
          </li>
          <li>
            <span className="stepnumber" aria-hidden="true">
              4.
            </span>
            <div>
              <p>
                Tap <strong>“Install”</strong>.
              </p>
            </div>
          </li>
        </ol>
      </div>
    </PaperShell>
  );
}
