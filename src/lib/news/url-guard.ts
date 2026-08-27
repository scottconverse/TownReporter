/** Client-safe URL and hash helpers. No Node built-ins. */

function isIP(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(h)) return true;
  // Hostnames cannot contain ':'; IPv6 literals always do.
  if (h.includes(":")) return true;
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (raw.startsWith("::ffff:") && raw.includes(".")) {
    return isBlockedAddress(raw.slice(raw.lastIndexOf(":") + 1));
  }
  if (raw.includes(".")) {
    const p = raw.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (raw === "::1" || raw === "::" || raw === "0:0:0:0:0:0:0:1") return true;
  if (raw.startsWith("fc") || raw.startsWith("fd")) return true;
  if (raw.startsWith("fe80")) return true;
  if (raw.startsWith("ff")) return true;
  return false;
}

export function assertHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) {
    throw new Error("That host is not fetchable");
  }
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    throw new Error("That host is not fetchable");
  }
  return url;
}

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export { isIP };
