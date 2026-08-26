export type EntityVerdict =
  | "same"
  | "confirmed-same"
  | "likely-same"
  | "possible"
  | "possible-same"
  | "confirmed-different"
  | "unresolved";

/** Matching key that strips legal suffixes — for comparison only, never a merge key. */
export function normalizeEntity(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(llc|l\.l\.c\.|inc|corp|corporation|ltd|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Stable identity key. Keeps LLC/Inc so two legal names stay two entities. */
export function identityKey(name: string): string {
  return name.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").slice(0, 160);
}

export function isConfirmedSame(verdict: EntityVerdict): boolean {
  return verdict === "same" || verdict === "confirmed-same";
}

export function resolveEntityName(
  name: string,
  known: { canonical: string; name: string }[],
): { verdict: EntityVerdict; canonical: string; matched?: string } {
  const key = identityKey(name);
  const n = normalizeEntity(name);
  if (!key) return { verdict: "unresolved", canonical: key };
  for (const k of known) {
    const kKey = identityKey(k.name) || k.canonical;
    if (kKey === key || k.canonical === key) {
      return { verdict: "same", canonical: k.canonical, matched: k.name };
    }
    const kn = normalizeEntity(k.name) || k.canonical;
    if (n && kn && n === kn && kKey !== key) {
      // Same core words, different legal suffix or spelling — do not collapse.
      return { verdict: "possible-same", canonical: k.canonical, matched: k.name };
    }
    const a = new Set(n.split(" ").filter((w) => w.length > 1));
    const b = new Set(kn.split(" ").filter((w) => w.length > 1));
    const inter = [...a].filter((w) => b.has(w));
    if (inter.length >= 2 && inter.length === Math.min(a.size, b.size) && Math.abs(a.size - b.size) <= 1) {
      return { verdict: "likely-same", canonical: k.canonical, matched: k.name };
    }
    if (inter.length >= 2) {
      return { verdict: "possible", canonical: k.canonical, matched: k.name };
    }
    if (n && kn && (n.includes(kn) || kn.includes(n))) {
      if (Math.min(n.length, kn.length) >= 6) {
        return { verdict: "possible", canonical: k.canonical, matched: k.name };
      }
    }
  }
  return { verdict: "unresolved", canonical: key };
}
