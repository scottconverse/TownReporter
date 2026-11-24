/**
 * Small, pure helpers for the public Registry cards (the Nov 23 2026 redesign).
 *
 * The cards show the three facts a reader on a phone needs first: a number to
 * call, a place to go and the hours. They pick the first of each from the
 * entry. Nothing here invents a fact: a card with no phone shows no phone.
 */

/** The colour group a category name belongs to. Unknown names fall in "more". */
const GROUPS: { key: string; hue: string; names: string[] }[] = [
  { key: "food", hue: "#e07b1f", names: ["Food"] },
  { key: "housing", hue: "#2f6fe0", names: ["Housing and shelter"] },
  {
    key: "health",
    hue: "#1f9d62",
    names: ["Health and dental", "Mental health and counseling", "Addiction recovery"],
  },
  {
    key: "crisis",
    hue: "#d6403f",
    names: ["Crisis lines", "Crisis", "Domestic violence and abuse"],
  },
  {
    key: "family",
    hue: "#9a4fd6",
    names: [
      "Children, youth and families",
      "Families and children",
      "Child care",
      "Schools and education",
    ],
  },
  { key: "older", hue: "#b88a00", names: ["Older adults and caregivers", "Disability"] },
  {
    key: "money",
    hue: "#188f86",
    names: ["Financial assistance", "Utilities help", "Jobs and job training", "Basic needs"],
  },
  { key: "legal", hue: "#d0408a", names: ["Legal aid", "Immigrants and language"] },
];

const MORE_HUE = "#6b7686";

/** The accent colour for a category name; a neutral grey when it is not known. */
export function registryCategoryHue(name: string | null | undefined): string {
  const wanted = (name ?? "").trim().toLowerCase();
  if (!wanted) return MORE_HUE;
  for (const group of GROUPS) {
    if (group.names.some((n) => n.toLowerCase() === wanted)) return group.hue;
  }
  return MORE_HUE;
}

/** A map link for a street address, or null when there is no street address. */
export function registryDirectionsHref(address: string | null | undefined): string | null {
  const text = (address ?? "").trim();
  if (!/^\d+\s/.test(text)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}

interface CardSource {
  locations: { address: string | null; phones: string[]; hours: string[] }[];
  servicePhones: string[];
  serviceHours: string[];
  organizationPhones: string[];
}

export interface RegistryCardFacts {
  phone: string | null;
  address: string | null;
  hours: string | null;
}

/** The first phone, street address and hours an entry holds, in that order of trust. */
export function registryCardFacts(entry: CardSource): RegistryCardFacts {
  const first = (items: (string | null | undefined)[]): string | null => {
    for (const item of items) {
      const text = (item ?? "").trim();
      if (text) return text;
    }
    return null;
  };
  return {
    phone: first([
      ...entry.servicePhones,
      ...entry.locations.flatMap((l) => l.phones),
      ...entry.organizationPhones,
    ]),
    address: first(entry.locations.map((l) => l.address)),
    hours: first([...entry.serviceHours, ...entry.locations.flatMap((l) => l.hours)]),
  };
}
