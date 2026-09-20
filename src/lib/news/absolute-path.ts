import { isAbsolute } from "node:path";

/**
 * True when a path is absolute in EITHER Windows or POSIX form, on any host.
 *
 * Node's `path.isAbsolute` is platform-specific: on Linux it reports
 * `D:\TownReporter\meetings` as relative, and on Windows it reports
 * `/mnt/data/meetings` as relative. TownReporter ships a Windows installer and
 * also runs on Linux servers, and an operator can legitimately type either
 * shape — including a Windows path while the app runs on Linux. Using the
 * platform-bound check meant the product advertised `D:\TownReporter\meetings`
 * in its own error message and then rejected it on CI.
 *
 * This accepts:
 *   - POSIX absolute:        /mnt/data/meetings
 *   - Windows drive absolute: D:\TownReporter\meetings, C:/data/meetings
 *   - Windows UNC:           \\server\share\meetings
 *
 * It deliberately does NOT accept a bare relative path, which is the case the
 * check exists to reject: a relative root resolves against the process working
 * directory, which is not a durable location.
 */
export function isAbsolutePathAnyPlatform(value: string): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  // Windows drive-qualified (back- or forward-slash separated).
  if (/^[A-Za-z]:[\\/]/.test(raw)) return true;
  // Windows UNC.
  if (/^\\\\[^\\]+\\/.test(raw)) return true;
  // POSIX absolute.
  if (raw.startsWith("/")) return true;
  // Fall back to the host's own notion, so a platform-specific form not
  // covered above (or a future one) still behaves as the runtime expects.
  return isAbsolute(raw);
}