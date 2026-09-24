/*
  Storage-root validation for meeting capture -- SERVER ONLY.

  These two helpers used to live in `meeting-settings.ts`, which a client
  component (`components/meeting-capture-settings.tsx`) imports for its
  `createServerFn` handles. Node builtins imported at the top of that module
  reach the browser graph, where Vite externalizes them and any property
  access throws at module evaluation:

    Module "node:path" has been externalized for browser compatibility.
    Cannot access "node:path.isAbsolute" in client code.

  A server function's handler body is replaced by an RPC stub in the client
  build, so a dynamic `await import()` inside the handler never follows the
  module into the browser. Keeping the filesystem touch-points behind that
  boundary is the whole reason this file exists -- same repair as the 0.6.61
  `node:child_process` fix.
*/
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isAbsolutePathAnyPlatform, normalizeAbsolutePath } from "./absolute-path.ts";

export { normalizeAbsolutePath } from "./absolute-path.ts";

export function storageRootRejectionReason(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return "Storage root is required. Enter an absolute folder path, e.g. D:\\TownReporter\\meetings";
  if (!isAbsolutePathAnyPlatform(value)) {
    return `Storage root must be an absolute path (got "${value}"). Enter a full path such as D:\\TownReporter\\meetings or /mnt/data/meetings.`;
  }
  return null;
}

/**
 * Verify the root is writable by performing a real write and delete at save
 * time. The error names the exact path and the underlying failure.
 */
export function assertStorageRootWritable(root: string): { ok: true } | { ok: false; error: string } {
  const resolved = normalizeAbsolutePath(root);
  const probe = join(resolved, `.townreporter-write-test-${Date.now()}`);
  try {
    mkdirSync(resolved, { recursive: true });
  } catch (error) {
    return { ok: false, error: `Could not create the storage root "${resolved}": ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    writeFileSync(probe, "townreporter write test", "utf8");
  } catch (error) {
    return { ok: false, error: `Storage root "${resolved}" is not writable: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    unlinkSync(probe);
  } catch {
    /* the write succeeded; a leftover probe file is not a failure */
  }
  return { ok: true };
}
