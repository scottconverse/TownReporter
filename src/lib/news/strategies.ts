/** Research strategies for a frontier item. A single zero-result query is not exhaustion. */

import { scopedQuery, type ResearchScope } from "./research-scope.ts";

export type ResearchStrategy = { key: string; query: string };

/**
 * Every strategy that names the paper's own place takes a `ResearchScope`
 * (./research-scope.ts) rather than a city default. There is no built-in town:
 * the city, the state and the official site's host come from paper settings,
 * and a paper that has not answered gets a query without them.
 */
export function strategiesForFrontier(
  kind: string,
  label: string,
  scope: ResearchScope,
): ResearchStrategy[] {
  const v = label.trim();
  if (!v) return [];
  const city = scope.city.trim();
  const state = scope.state.trim();
  const stripped = v
    .replace(/\s+(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?)\.?$/i, "")
    .trim();
  /*
    The state's own business registry, only for the state this paper is in. It
    is one operator for one registry (Colorado's), so a paper elsewhere must
    not be handed it; a paper with no state configured has not said.
  */
  const stateCorporate = /^(colorado|co)$/i.test(state)
    ? [{ key: "state-corporate", query: scopedQuery([`"${v}"`, "site:sos.state.co.us"]) }]
    : [];
  const siteGov = scope.officialHost
    ? [{ key: "site-gov", query: scopedQuery([`"${v}"`, `site:${scope.officialHost}`]) }]
    : [];
  switch (kind) {
    case "company":
      return [
        { key: "exact-name", query: scopedQuery([`"${v}"`, city]) },
        { key: "stripped-suffix", query: scopedQuery([`"${stripped}"`, city]) },
        { key: "registered-agent", query: scopedQuery([`"${v}"`, `"registered agent"`, state]) },
        { key: "owner-officer", query: scopedQuery([`"${v}"`, "(owner OR officer OR principal)", state]) },
        { key: "address", query: scopedQuery([`"${v}"`, `(address OR street OR "registered office")`, city]) },
        ...stateCorporate,
        { key: "parcel", query: scopedQuery([`"${v}"`, "(parcel OR assessor)", city]) },
        { key: "contract", query: scopedQuery([`"${v}"`, "(contract OR RFP OR bid)", city]) },
        ...siteGov,
        { key: "historical-archive", query: `"${v}" (wayback OR archive.org)` },
      ];
    case "person":
      return [
        { key: "exact-name", query: scopedQuery([`"${v}"`, city]) },
        { key: "registered-agent", query: scopedQuery([`"${v}"`, `"registered agent"`, state]) },
        { key: "owner-officer", query: scopedQuery([`"${v}"`, "(officer OR principal OR director)", state]) },
        { key: "campaign", query: `"${v}" campaign contribution` },
        { key: "planning", query: scopedQuery([`"${v}"`, "planning", city]) },
        { key: "address", query: scopedQuery([`"${v}"`, "(address OR street)", city]) },
        { key: "historical-archive", query: `"${v}" (wayback OR archive.org)` },
      ];
    case "parcel":
      return [
        { key: "exact-name", query: scopedQuery(["parcel", v, city]) },
        { key: "assessor", query: scopedQuery([v, "assessor", city]) },
        { key: "owner-officer", query: `parcel ${v} owner` },
        ...siteGov,
      ];
    case "contract":
    case "rfp":
    case "legislation":
    case "planning":
      return [
        { key: "exact-name", query: scopedQuery([`"${v}"`, city]) },
        ...siteGov,
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
        { key: "exact-name", query: scopedQuery([`"${v}"`, city]) },
        { key: "stripped-suffix", query: scopedQuery([`"${stripped}"`, city]) },
        { key: "historical-archive", query: `"${v}" (wayback OR archive.org)` },
      ];
  }
}

export function strategyKeyForQuery(
  kind: string,
  label: string,
  query: string,
  scope: ResearchScope,
): string {
  const q = query.trim().toLowerCase();
  for (const s of strategiesForFrontier(kind, label, scope)) {
    if (s.query.trim().toLowerCase() === q) return s.key;
  }
  if (/\baddress\b|\bstreet\b/i.test(query)) return "address";
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
  scope: ResearchScope,
): ResearchStrategy[] {
  const tried = new Set(triedKeys);
  return strategiesForFrontier(kind, label, scope).filter((s) => !tried.has(s.key));
}

export function queryFingerprint(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 300);
}
