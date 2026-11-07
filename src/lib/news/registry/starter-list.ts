/**
 * The newsroom's starter list of community resources (spec 24, Phase 1).
 *
 * Eleven places to get help in and around Longmont, each read from its own
 * page on 2026-11-05. The editor loads them onto the desk with one press and
 * publishes each one only after reading it; nothing here is published by
 * being listed.
 *
 * Pure and browser-safe: the desk imports this file to show a row's own
 * "Page read on …" line, and the loader imports it to build the HSDS bundle.
 * Every fact below is copied from the table the editor approved -- no phone,
 * address, hours or claim has been added.
 */

import type { HsdsBundle, HsdsOrganization } from "./hsds-types.ts";

/** The day every page in this list was read. */
export const STARTER_LIST_CHECKED_ON = "2026-11-05";

/** The directory name the importer keys these rows on. */
export const STARTER_LIST_DIRECTORY = "TownReporter starter list";

/** The bundle's provenance URL; each entry then points at its own page. */
export const STARTER_LIST_SOURCE_URL = "hsds://townreporter-starter-list";

export interface StarterEntry {
  /** Stable slug; also the tail of the entry's HSDS ids. */
  key: string;
  organizationName: string;
  serviceName: string;
  category: string;
  description: string;
  phone: string | null;
  address: string | null;
  languages: string[];
  sourceTitle: string;
  sourceUrl: string;
  checkedOn: string;
}

/** The eleven entries the editor approved, in the order given. */
export const STARTER_ENTRIES: readonly StarterEntry[] = [
  {
    key: "our-center",
    organizationName: "OUR Center",
    serviceName: "Help with basic needs",
    category: "Basic needs",
    description: 'Walk-in help and same-day "Resource Now" appointments in Longmont.',
    phone: "303-772-5529",
    address: null,
    languages: ["English", "Spanish"],
    sourceTitle: "OUR Center referral program",
    sourceUrl: "https://www.ourcenter.org/referral-program/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "211-colorado",
    organizationName: "2-1-1 Colorado",
    serviceName: "Find help by phone, text or chat",
    category: "Finding help",
    description:
      "Call 211 or (866) 760-6489. Text your ZIP code to 898-211. Live chat with a navigator on the website.",
    phone: "211",
    address: null,
    languages: [],
    sourceTitle: "2-1-1 Colorado",
    sourceUrl: "https://www.211colorado.org/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "988-lifeline",
    organizationName: "988 Suicide & Crisis Lifeline",
    serviceName: "Crisis line",
    category: "Crisis",
    description: "Call or text 988, or chat online. Free, 24 hours a day, 7 days a week.",
    phone: "988",
    address: null,
    languages: [],
    sourceTitle: "988 Suicide & Crisis Lifeline",
    sourceUrl: "https://988lifeline.org/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "bc-aging-navigator",
    organizationName: "Boulder County Area Agency on Aging",
    serviceName: "Resource Navigator",
    category: "Older adults and caregivers",
    description:
      "A person who helps older adults, people with disabilities and caregivers find services. Email AgingResources@bouldercounty.gov.",
    phone: "303-441-1617",
    address: null,
    languages: ["English", "Spanish"],
    sourceTitle: "Boulder County Network of Care",
    sourceUrl: "https://aging.networkofcare.org/boulder-co/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "longmont-senior-supportive",
    organizationName: "City of Longmont Senior Services",
    serviceName: "Supportive Services",
    category: "Older adults and caregivers",
    description:
      "City help for older adults in Longmont. Call or use the request form on the city page.",
    phone: "303-651-8414",
    address: null,
    languages: [],
    sourceTitle: "City of Longmont Senior Services, Supportive Services",
    sourceUrl: "https://longmontcolorado.gov/senior-services/supportive-services/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "hunger-free-hotline",
    organizationName: "Hunger Free Colorado",
    serviceName: "Food Resource Hotline",
    category: "Food",
    description: "A hotline that helps you find food near you, in more than 150 languages.",
    phone: "855-855-4626",
    address: null,
    languages: [],
    sourceTitle: "Hunger Free Colorado, Find Food",
    sourceUrl: "https://hungerfreecolorado.org/find-food/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "community-food-share",
    organizationName: "Community Food Share",
    serviceName: "Find Food map",
    category: "Food",
    description:
      "A map of food pantries in Boulder and Broomfield counties, with an appointment portal.",
    phone: null,
    address: null,
    languages: [],
    sourceTitle: "Community Food Share, Find Food",
    sourceUrl: "https://communityfoodshare.org/find-food/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "boco-findhelp",
    organizationName: "Boulder County Family Resource Network",
    serviceName: "Boulder County Findhelp",
    category: "Finding help",
    description: "Search free and low-cost services by ZIP code. No account needed.",
    phone: null,
    address: null,
    languages: [],
    sourceTitle: "Boulder County Findhelp",
    sourceUrl: "https://boco.findhelp.com/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "longmont-resource-navigation",
    organizationName: "City of Longmont Community Relations",
    serviceName: "Resource Navigation",
    category: "Finding help",
    description: "City staff help you find programs, in English and Spanish.",
    phone: null,
    address: null,
    languages: ["English", "Spanish"],
    sourceTitle: "City of Longmont Resource Navigation",
    sourceUrl:
      "https://longmontcolorado.gov/community-and-neighborhood-resources/community-relations/resource-navigation/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "svvsd-outreach",
    organizationName: "St. Vrain Valley Schools",
    serviceName: "Community Outreach Liaisons",
    category: "Families and children",
    description:
      "School district staff who connect families with community resources. Second number: 303-702-7840.",
    phone: "303-702-7836",
    address: null,
    languages: [],
    sourceTitle: "St. Vrain Valley Schools, Community Resources",
    sourceUrl: "https://www.svvsd.org/departments/student-services/community-resources/",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
  {
    key: "bc-coordinated-entry",
    organizationName: "Boulder County Coordinated Entry",
    serviceName: "Coordinated Entry for shelter",
    category: "Housing and shelter",
    description: "The first step to get shelter in Boulder County.",
    phone: "303-579-4404",
    address: null,
    languages: [],
    sourceTitle: "City of Boulder, Homelessness Services",
    sourceUrl: "https://bouldercolorado.gov/services/homelessness-services",
    checkedOn: STARTER_LIST_CHECKED_ON,
  },
] as const;

/** A taxonomy id that is stable across every load of the list. */
export function starterTaxonomyId(category: string): string {
  return `starter-tax-${category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

/** The organization's HSDS id for one entry. */
export function starterOrganizationId(key: string): string {
  return `starter-org-${key}`;
}

/** The service's HSDS id for one entry. */
export function starterServiceId(key: string): string {
  return `starter-svc-${key}`;
}

/** The phone contact's HSDS id for one entry. */
export function starterPhoneId(key: string): string {
  return `starter-phone-${key}`;
}

/** The location's HSDS id for one entry, used only when it has an address. */
export function starterLocationId(key: string): string {
  return `starter-loc-${key}`;
}

/** The "Page read on …" date for each starter service, keyed by HSDS id. */
export const STARTER_CHECKED_ON_BY_SERVICE_ID: Readonly<Record<string, string>> =
  Object.fromEntries(STARTER_ENTRIES.map((entry) => [starterServiceId(entry.key), entry.checkedOn]));

/** The categories this list files entries under, deduplicated in first-seen order. */
export function starterCategories(): string[] {
  return [...new Set(STARTER_ENTRIES.map((entry) => entry.category))];
}

/**
 * Turn the approved list into an HSDS bundle.
 *
 * One organization and one service per entry, a phone on the service where the
 * table gives one, a language row where it gives one, and a location only
 * where an address is given (none of the eleven has one). Nothing else.
 */
export function starterBundle(): HsdsBundle {
  const taxonomies = starterCategories().map((name) => ({
    id: starterTaxonomyId(name),
    name,
    parent_id: null,
  }));

  const organizations: HsdsOrganization[] = STARTER_ENTRIES.map((entry) => {
    const serviceId = starterServiceId(entry.key);
    const locationId = starterLocationId(entry.key);
    return {
      id: starterOrganizationId(entry.key),
      name: entry.organizationName,
      status: "unverified",
      services: [
        {
          id: serviceId,
          name: entry.serviceName,
          description: entry.description,
          status: "unverified",
          taxonomy_id: starterTaxonomyId(entry.category),
          phones: entry.phone
            ? [
                {
                  id: starterPhoneId(entry.key),
                  phone: entry.phone,
                },
              ]
            : [],
          languages: entry.languages.map((language, index) => ({
            id: `${serviceId}:language:${index}`,
            language,
          })),
          service_at_locations: entry.address
            ? [{ id: `starter-sal-${entry.key}`, location_id: locationId }]
            : [],
        },
      ],
      locations: entry.address
        ? [
            {
              id: locationId,
              name: entry.organizationName,
              address_1: entry.address,
              status: "unverified",
            },
          ]
        : [],
    };
  });

  return { organizations, taxonomies };
}

/**
 * The "Page read on Nov. 5, 2026" line for an ISO date.
 *
 * Spelled out rather than run through a locale formatter: the desk and a test
 * must agree on the words, and the reader's browser locale must not decide
 * which language an English paper prints.
 */
export function checkedOnLabel(iso: string): string {
  const months = [
    "Jan.",
    "Feb.",
    "Mar.",
    "Apr.",
    "May",
    "June",
    "July",
    "Aug.",
    "Sept.",
    "Oct.",
    "Nov.",
    "Dec.",
  ];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return `Page read on ${iso}`;
  const [, year, month, day] = match;
  return `Page read on ${months[Number(month) - 1]} ${Number(day)}, ${year}`;
}
