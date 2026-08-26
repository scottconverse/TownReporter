import { SOURCE_ZIP_BACKUP, SOURCE_ZIP_URL } from "@/lib/source-zip-url";

function openZip(url: string) {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    window.prompt("Copy this into a new Chrome or Safari tab:", url);
  }
}

/** href stays on-origin so this preview never navigates to a zip (gray sad face). */
export function SourceZipButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <a
      href="/get-the-code"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        openZip(SOURCE_ZIP_URL);
      }}
    >
      {children}
    </a>
  );
}

export function SourceZipBackupLink({ className }: { className?: string }) {
  return (
    <a
      href="/get-the-code"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        openZip(SOURCE_ZIP_BACKUP);
      }}
    >
      Backup link
    </a>
  );
}

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
