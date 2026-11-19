import { useEffect, useRef, useState } from "react";
import { InkButton } from "@/components/desk-chrome";
import { exportRegistryDirectory } from "@/lib/news/registry/registry-desk-write";

/**
 * Download a directory file (spec 24, Phase 4).
 *
 * One button per directory. The server returns the directory as the same JSON
 * the import reads, without the rows an editor removed, and this panel hands it
 * to the browser as a file. Nothing is changed in the registry. The file is for
 * keeping a copy and for moving a directory to another desk: it is not a
 * certified HSDS export.
 */

export const EXPORT_FAILED = "The file could not be made. Nothing was changed.";

type Status = { kind: "done" | "failed"; text: string; count: number };

/** Hand the text to the browser as a file, then let go of the object URL. */
function saveTextFile(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  // The revoke waits a moment: some browsers cancel a download whose URL is
  // revoked in the same tick as the click.
  const revoke = () => setTimeout(() => URL.revokeObjectURL(url), 1000);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    revoke();
  }
}

export function RegistryExportPanel({ directoryNames }: { directoryNames: string[] }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const running = useRef(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  // Focus goes to the status line each time it says something new.
  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  const download = async (directoryName: string) => {
    if (running.current) return;
    running.current = true;
    setBusy(directoryName);
    try {
      const result = await exportRegistryDirectory({ data: { directoryName } });
      if (!result.ok) {
        setStatus((previous) => ({ kind: "failed", text: EXPORT_FAILED, count: (previous?.count ?? 0) + 1 }));
        return;
      }
      saveTextFile(result.fileName, result.json);
      setStatus((previous) => ({
        kind: "done",
        text: `Downloaded ${result.fileName}.`,
        count: (previous?.count ?? 0) + 1,
      }));
    } catch {
      setStatus((previous) => ({ kind: "failed", text: EXPORT_FAILED, count: (previous?.count ?? 0) + 1 }));
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  return (
    <div className="mb-6">
      <h3 className="font-display text-xl">Download a directory file</h3>
      <p className="wire-sum">
        A JSON file of one directory, in the shape the import reads. Rows an editor removed are
        left out. Downloading changes nothing in the registry.
      </p>
      {directoryNames.length === 0 ? (
        <p className="wire-sum">No directory has been imported yet, so there is nothing to download.</p>
      ) : (
        <ul className="astra-plain">
          {directoryNames.map((directory) => (
            <li key={directory} className="flex flex-wrap items-center gap-2">
              <span className="text-base">{directory}</span>
              <InkButton
                tone="ghost"
                disabled={busy !== null}
                pending={busy === directory}
                pendingLabel="Making the file…"
                onClick={() => void download(directory)}
                ariaLabel={`Download directory file for ${directory}`}
              >
                Download directory file
              </InkButton>
            </li>
          ))}
        </ul>
      )}
      {status ? (
        <p
          ref={statusRef}
          tabIndex={-1}
          className="mt-3 text-base text-ink"
          role={status.kind === "failed" ? "alert" : "status"}
          aria-live={status.kind === "failed" ? "assertive" : "polite"}
          data-testid="export-status"
        >
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
