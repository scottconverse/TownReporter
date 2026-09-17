/** Client-safe source-credit helpers used by the Story workspace and writer. */
export function outletNamesForHost(url: string): string[] {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    if (host.includes("longmontleader")) return ["Longmont Leader", "the Leader"];
    if (host.includes("timescall")) return ["Longmont Times-Call", "Times-Call"];
    if (host.includes("dailycamera")) return ["Daily Camera"];
    if (host.includes("longmontcolorado.gov")) return ["City of Longmont"];
  } catch {
    /* ignore malformed source URLs */
  }
  return [];
}

function spacedWords(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

export function uncreditedOutlets(body: string, sourceUrls: string[]): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const url of sourceUrls) {
    const names = outletNamesForHost(url);
    if (names.length === 0) continue;
    const primary = names[0]!;
    if (seen.has(primary)) continue;
    const credited = names.some((name) => spacedWords(body).includes(spacedWords(name)));
    seen.add(primary);
    if (!credited) missing.push(primary);
  }
  return missing;
}
