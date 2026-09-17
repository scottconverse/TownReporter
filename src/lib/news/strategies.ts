/** Research strategies for a frontier item. A single zero-result query is not exhaustion. */

export type ResearchStrategy = { key: string; query: string };

export function strategiesForFrontier(
  kind: string,
  label: string,
  city = "Longmont",
): ResearchStrategy[] {
  const v = label.trim();
  if (!v) return [];
  const stripped = v
    .replace(/\s+(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?)\.?$/i, "")
    .trim();
  switch (kind) {
    case "company":
      return [
        { key: "exact-name", query: `"${v}" ${city}` },
        { key: "stripped-suffix", query: `"${stripped}" ${city}` },
        { key: "registered-agent", query: `"${v}" "registered agent" Colorado` },
        { key: "owner-officer", query: `"${v}" (owner OR officer OR principal) Colorado` },
        { key: "address", query: `"${v}" (address OR street OR "registered office") ${city}` },
        { key: "state-corporate", query: `"${v}" site:sos.state.co.us` },
        { key: "parcel", query: `"${v}" (parcel OR assessor) ${city}` },
        { key: "contract", query: `"${v}" (contract OR RFP OR bid) ${city}` },
        { key: "site-gov", query: `"${v}" site:longmontcolorado.gov` },
        { key: "historical-archive", query: `"${v}" (wayback OR archive.org)` },
      ];
    case "person":
      return [
        { key: "exact-name", query: `"${v}" ${city}` },
        { key: "registered-agent", query: `"${v}" "registered agent" Colorado` },
        { key: "owner-officer", query: `"${v}" (officer OR principal OR director) Colorado` },
        { key: "campaign", query: `"${v}" campaign contribution` },
        { key: "planning", query: `"${v}" planning ${city}` },
        { key: "address", query: `"${v}" (address OR street) ${city}` },
        { key: "historical-archive", query: `"${v}" (wayback OR archive.org)` },
      ];
    case "parcel":
      return [
        { key: "exact-name", query: `parcel ${v} ${city}` },
        { key: "assessor", query: `${v} assessor ${city}` },
        { key: "owner-officer", query: `parcel ${v} owner` },
        { key: "site-gov", query: `${v} site:longmontcolorado.gov` },
      ];
    case "contract":
    case "rfp":
    case "legislation":
    case "planning":
      return [
        { key: "exact-name", query: `"${v}" ${city}` },
        { key: "site-gov", query: `"${v}" site:longmontcolorado.gov` },
        { key: "contract", query: `"${v}" (contract OR RFP OR bid OR ordinance)` },
        { key: "historical-archive", query: `"${v}" (wayback OR archive.org)` },
      ];
    case "url":
    case "missing-record":
      return [
        { key: "exact-name", query: v },
        { key: "historical-archive", query: `"${v}" (wayback OR archive.org OR relocated)` },
      ];
    default:
      return [
        { key: "exact-name", query: `"${v}" ${city}` },
        { key: "stripped-suffix", query: `"${stripped}" ${city}` },
        { key: "historical-archive", query: `"${v}" (wayback OR archive.org)` },
      ];
  }
}

export function strategyKeyForQuery(kind: string, label: string, query: string): string {
  const q = query.trim().toLowerCase();
  for (const s of strategiesForFrontier(kind, label)) {
    if (s.query.trim().toLowerCase() === q) return s.key;
  }
  if (/\baddress\b|\bstreet\b|\bcoffman\b|\bmain street\b/i.test(query)) return "address";
  if (/registered agent/i.test(query)) return "registered-agent";
  if (/site:sos\.state\.co\.us/i.test(query)) return "state-corporate";
  if (/wayback|archive\.org/i.test(query)) return "historical-archive";
  if (/parcel|assessor/i.test(query)) return "parcel";
  if (/contract|rfp|bid/i.test(query)) return "contract";
  const stripped = label
    .replace(/\s+(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?)\.?$/i, "")
    .trim()
    .toLowerCase();
  if (stripped && q.includes(stripped) && !q.includes(label.trim().toLowerCase())) {
    return "stripped-suffix";
  }
  return "adhoc";
}

export function remainingStrategies(
  kind: string,
  label: string,
  triedKeys: string[],
): ResearchStrategy[] {
  const tried = new Set(triedKeys);
  return strategiesForFrontier(kind, label).filter((s) => !tried.has(s.key));
}

export function queryFingerprint(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 300);
}
