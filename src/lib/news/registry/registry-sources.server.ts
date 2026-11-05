/**
 * Registry source roles (spec 13.2, 14 and 22).
 *
 * A `resource_sources` row says what a source is to the registry: an
 * organization feed, a service feed, a location feed, or a directory to import.
 * It is NOT a kind of source. The same `sources` row can be watched for news
 * and read for the registry at the same time -- that is the spec's explicit
 * rule (section 14: "a source can be both a news source and a registry source;
 * neither output suppresses the other"), and it is why this is a join table
 * rather than a column on `sources`.
 *
 * Every function here takes the `Sql` it should use, so a caller inside a
 * transaction (the seed path) and a caller outside one (a scan) share the same
 * statements.
 */

import type { Sql } from "../../db.ts";

export const REGISTRY_ROLES = ["organization", "service", "location", "directory"] as const;

export type RegistryRole = (typeof REGISTRY_ROLES)[number];

export interface RegistrySource {
  /** `resource_sources.id`, the join row. */
  id: number;
  sourceId: number;
  registryRole: RegistryRole;
  directoryName: string | null;
  url: string;
  title: string;
  kind: string;
  tier: string;
  status: string;
}

/**
 * Mark a source with a registry role. Idempotent: the table's
 * (newsroom_id, source_id, registry_role) key makes a second call a no-op.
 * Returns true only when this call created the row.
 */
export async function markRegistrySource(
  sql: Sql,
  input: {
    newsroomId: number;
    sourceId: number;
    registryRole: RegistryRole;
    directoryName?: string | null;
  },
): Promise<boolean> {
  const rows = await sql.query<{ id: number }>(
    `insert into resource_sources (newsroom_id, source_id, registry_role, directory_name)
     values ($1, $2, $3, $4)
     on conflict (newsroom_id, source_id, registry_role) do nothing
     returning id`,
    [input.newsroomId, input.sourceId, input.registryRole, input.directoryName ?? null],
  );
  return rows.length > 0;
}

/** Every registry source in a newsroom, joined to the source it marks. */
export async function listRegistrySources(
  sql: Sql,
  newsroomId: number,
): Promise<RegistrySource[]> {
  const rows = await sql.query<{
    id: number;
    source_id: number;
    registry_role: RegistryRole;
    directory_name: string | null;
    url: string;
    title: string;
    kind: string;
    tier: string;
    status: string;
  }>(
    `select r.id, r.source_id, r.registry_role, r.directory_name,
            s.url, s.title, s.kind, s.tier, s.status
       from resource_sources r
       join sources s on s.id = r.source_id and s.newsroom_id = r.newsroom_id
      where r.newsroom_id = $1
      order by r.id`,
    [newsroomId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    sourceId: Number(row.source_id),
    registryRole: row.registry_role,
    directoryName: row.directory_name,
    url: row.url,
    title: row.title,
    kind: row.kind,
    tier: row.tier,
    status: row.status,
  }));
}

/** Is this source a registry source in this newsroom, in any role? */
export async function isRegistrySource(
  sql: Sql,
  newsroomId: number,
  sourceId: number,
): Promise<boolean> {
  const rows = await sql.query<{ one: number }>(
    `select 1 as one from resource_sources
      where newsroom_id = $1 and source_id = $2 limit 1`,
    [newsroomId, sourceId],
  );
  return rows.length > 0;
}

/**
 * Source id -> the registry roles it carries, for one newsroom.
 *
 * The scan reads this once per run rather than asking per batch, and uses it
 * only to decide whether the batch prompt should ask for registry changes and
 * which source's tier an evidence row takes. A source with several roles
 * appears once with all of them.
 */
export async function registryRolesBySource(
  sql: Sql,
  newsroomId: number,
): Promise<Map<number, Set<RegistryRole>>> {
  const rows = await sql.query<{ source_id: number; registry_role: RegistryRole }>(
    `select source_id, registry_role from resource_sources where newsroom_id = $1`,
    [newsroomId],
  );
  const map = new Map<number, Set<RegistryRole>>();
  for (const row of rows) {
    const sourceId = Number(row.source_id);
    const roles = map.get(sourceId) ?? new Set<RegistryRole>();
    roles.add(row.registry_role);
    map.set(sourceId, roles);
  }
  return map;
}
