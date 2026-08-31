import { createFileRoute, Link } from "@tanstack/react-router";
import { SourceZipBackupLink, SourceZipButton, SourceZipUrl } from "@/components/source-zip";
import { usePaper } from "@/lib/paper-context";
import { APP_VERSION } from "@/lib/version";

export const Route = createFileRoute("/get-the-code")({
  component: GetTheCode,
});

function GetTheCode() {
  const PAPER = usePaper();
  return (
    <main
      className="grid min-h-dvh place-items-center bg-paper px-6 text-ink"
      style={{ background: "#F6F1E7", color: "#1C1410", minHeight: "100dvh" }}
    >
      <div className="w-full max-w-md space-y-5">
        <p className="text-[11px] tracking-[0.18em] text-rust uppercase">
          {PAPER.name}
        </p>
        <h1 className="font-display text-3xl font-semibold">Download the source</h1>
        <p className="text-ink-2">
          This copy is TownReporter {APP_VERSION}. The black button opens a real browser tab. This preview cannot save
          files itself.
        </p>
        <SourceZipButton className="inline-flex min-h-12 w-full items-center justify-center bg-ink px-5 text-sm font-medium text-paper hover:bg-ink-2">
          Download TownReporter.zip
        </SourceZipButton>
        <p className="text-sm text-muted">Paste this into Chrome or Safari if the button is blocked:</p>
        <SourceZipUrl />
        <p className="text-sm text-muted">
          <SourceZipBackupLink className="underline hover:text-ink" /> if the
          first link is gone.
        </p>
        <p>
          <Link to="/" className="text-sm text-muted hover:text-ink">
            Back to the paper
          </Link>
        </p>
      </div>
    </main>
  );
}
