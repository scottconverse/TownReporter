/** Client-safe URL and hash helpers. No Node built-ins. */

function isIP(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(h)) return true;
  // Hostnames cannot contain ':'; IPv6 literals always do.
  if (h.includes(":")) return true;
  return false;
}

/** `::ffff:7f00:1` and `::ffff:127.0.0.1` are 127.0.0.1. URL parsers emit the hex form. */
function v4FromMapped6(raw: string): string | null {
  const dotted = raw.match(/^(?:(?:0:){1,5}|::)ffff:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted?.[1]) return dotted[1];
  const hex = raw.match(/^(?:(?:0:){1,5}|::)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1]!, 16);
  const lo = Number.parseInt(hex[2]!, 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

function looksIPv4Mapped(raw: string): boolean {
  return raw.startsWith("::ffff:") || /^(?:0:){1,5}ffff:/.test(raw);
}

/**
 * The eight hextets of an IPv6 literal, with `::` expanded. Null if it is not
 * one.
 *
 * The ranges below are decided by bit position, so the literal has to be
 * parsed rather than string-matched: `2002:7f00::` and `2002:0:7f00::` name
 * the same 6to4 prefix, and `64:ff9b::7f00:1` spells 127.0.0.1 without a dot
 * anywhere in it.
 */
function expandHextets(raw: string): number[] | null {
  if (!raw.includes(":")) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0] ?? "");
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parseGroups(halves[1] ?? "");
  if (!tail) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/** Two hextets as a dotted quad -- the order an IPv4-in-IPv6 embedding uses. */
function dottedFromHextets(hi: number, lo: number): string {
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

export function isBlockedAddress(ip: string): boolean {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = v4FromMapped6(raw);
  if (mapped) return isBlockedAddress(mapped);
  if (looksIPv4Mapped(raw)) return true;
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
    // 198.18.0.0/15, benchmarking (RFC 2544). Reserved, and some stacks route
    // it locally.
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 192.0.0.0/24, IETF protocol assignments, including the 192.0.0.170/171
    // NAT64 discovery anycast pair.
    if (a === 192 && b === 0 && p[2] === 0) return true;
    if (a >= 224) return true;
    return false;
  }
  const hextets = expandHextets(raw);
  // An IPv6 literal this cannot parse is not something to fetch.
  if (!hextets) return true;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [
    number, number, number, number, number, number, number, number,
  ];
  // `::` and `::1`.
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0 && h7 <= 1) {
    return true;
  }
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
  if ((h0 & 0xfe00) === 0xfc00) return true;
  if ((h0 & 0xffc0) === 0xfe80) return true;
  if ((h0 & 0xff00) === 0xff00) return true;
  /*
    The transition and translation prefixes, which reach a private address
    through a literal with no dot in it:

      64:ff9b::/96     NAT64 well-known prefix  -- IPv4 in the last 32 bits
      64:ff9b:1::/48   NAT64 local-use prefix   -- IPv4 per RFC 6052's /48
      2002::/16        6to4                     -- IPv4 in the first 32 bits
  */
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return isBlockedAddress(dottedFromHextets(h6, h7));
  }
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0x1) {
    // RFC 6052's /48 layout puts the first two octets in the fourth hextet,
    // then a zero octet, then the third and fourth. RFC 8215 declines to fix
    // a layout for this prefix at all, so an address whose octet there is not
    // zero is not one this can reason about -- and is refused.
    const reserved = h4 >> 8;
    if (reserved !== 0) return true;
    return isBlockedAddress(
      `${(h3 >> 8) & 255}.${h3 & 255}.${h4 & 255}.${(h5 >> 8) & 255}`,
    );
  }
  if (h0 === 0x2002) return isBlockedAddress(dottedFromHextets(h1, h2));
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

export async function sha256Bytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export { isIP };
