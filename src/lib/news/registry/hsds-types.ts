/**
 * The HSDS 3.0 shapes this registry reads and writes (spec section 7).
 *
 * Field names are the HSDS names, verbatim and in snake_case, so a bundle
 * published by a directory imports without a translation table and exports
 * back under the same keys (section 7.3 compatibility obligation).
 *
 * The nesting is the one a directory's JSON bundle uses: organizations at the
 * top, with their services, locations, phones, schedules and so on inside
 * them. `rowsToBundle` in `hsds-map.ts` rebuilds exactly this shape.
 */

export type HsdsStatus = "active" | "inactive" | "unverified";

export interface HsdsPhone {
  /** HSDS publishes phones without ids in nested form; ours get one on import. */
  id?: string | null;
  name?: string | null;
  role?: string | null;
  department?: string | null;
  phone?: string | null;
  phone_extension?: string | null;
  email?: string | null;
  website?: string | null;
}

export interface HsdsSchedule {
  id: string;
  by_appointment?: boolean | null;
  days?: string | null;
  opens_at?: string | null;
  closes_at?: string | null;
  notes?: string | null;
}

export interface HsdsEligibility {
  id: string;
  description?: string | null;
  criteria?: Record<string, unknown> | null;
}

export interface HsdsRequiredDocument {
  id: string;
  document: string;
  description?: string | null;
  required?: boolean | null;
}

export interface HsdsLanguage {
  id: string;
  language: string;
  note?: string | null;
}

export interface HsdsAccessibility {
  id: string;
  accessibility: string;
  details?: string | null;
}

export interface HsdsServiceAtLocation {
  id: string;
  location_id: string;
  description?: string | null;
  schedule_id?: string | null;
}

export interface HsdsService {
  id: string;
  name: string;
  description?: string | null;
  url?: string | null;
  status?: HsdsStatus | null;
  taxonomy_id?: string | null;
  fees?: string | null;
  application_process?: string | null;
  crisis?: boolean | null;
  phones?: HsdsPhone[];
  schedules?: HsdsSchedule[];
  eligibilities?: HsdsEligibility[];
  required_documents?: HsdsRequiredDocument[];
  languages?: HsdsLanguage[];
  accessibilities?: HsdsAccessibility[];
  service_at_locations?: HsdsServiceAtLocation[];
}

export interface HsdsLocation {
  id: string;
  name?: string | null;
  description?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accessibility_notes?: string | null;
  transportation_notes?: string | null;
  status?: HsdsStatus | null;
  phones?: HsdsPhone[];
  schedules?: HsdsSchedule[];
  accessibilities?: HsdsAccessibility[];
}

export interface HsdsOrganization {
  id: string;
  name: string;
  alternate_name?: string | null;
  description?: string | null;
  email?: string | null;
  website?: string | null;
  legal_status?: string | null;
  status?: HsdsStatus | null;
  phones?: HsdsPhone[];
  services?: HsdsService[];
  locations?: HsdsLocation[];
}

export interface HsdsTaxonomy {
  id: string;
  name: string;
  parent_id?: string | null;
}

export interface HsdsBundle {
  organizations: HsdsOrganization[];
  taxonomies?: HsdsTaxonomy[];
}
