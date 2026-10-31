import { createFileRoute, Link } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { SourceZipBackupLink, SourceZipButton, SourceZipUrl } from "@/components/source-zip";
import { usePaper } from "@/lib/paper-context-state";
import { APP_VERSION } from "@/lib/version";

export const Route = createFileRoute("/get-the-code")({
  component: GetTheCode,
});

function GetTheCode() {
  const PAPER = usePaper();
  return (
    <PaperShell compact>
      <div className="getcode-page">
        <span className="eyebrow">{PAPER.name}</span>
        <h1>Download the source</h1>
        <p>
          This copy is TownReporter {APP_VERSION}. The button opens a real browser tab. This preview
          cannot save files itself.
        </p>
        <SourceZipButton className="btn primary getcode-download">
          Download TownReporter.zip
        </SourceZipButton>
        <p>Paste this into Chrome or Safari if the button is blocked:</p>
        <SourceZipUrl />
        <p>
          <SourceZipBackupLink className="backup-link" /> if the first link is gone.
        </p>
        <p>
          <Link to="/" className="getcode-back">
            Back to the paper
          </Link>
        </p>
      </div>
    </PaperShell>
  );
}
