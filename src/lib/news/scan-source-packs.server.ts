/**
 * P0-1 / P0-2 — custom source selection and saved source packs.
 *
 * Source SELECTION is separated from ANALYSIS coverage: a scan scope resolves
 * to an explicit set of accepted source IDs, persisted into the run snapshot
 * BEFORE any fetch begins. This module owns that resolution and the pack CRUD,
 * shared by custom scans, pack scans, and (via section-types) section scans.
 *
 * Resolution never returns a non-accepted source, and never mutates section
 * assignments or the daily schedule.
 */
import { getSql } from "@/lib/db";
import type { CustomScanSnapshot } from "./section-types.ts";

export type ScanSourcePack = {
  id: number;
  name: string;
  sourceIds: number[];
  /** How many of this pack's members are still accepted, for the UI. */
  acceptedCount: number;
};

export type SourcePackRow = { id: number; name: string; source_ids: number[] | null };

export const SUGGESTED_SCAN_PACKS = [
  "Government & council",
  "Schools & education",
  "Business & economy",
  "Public safety",
  "Transportation",
  "Housing & planning",
  "Health & social services",
  "Arts/culture/community life",
  "Environment & outdoors",
  "Local news & media",
] as const;

/**
 * Resolve the explicit accepted source set for a custom scan (P0-1) or a saved
 * pack (P0-2). Returns a `CustomScanSnapshot` carrying only accepted IDs.
 *
 * - `packId` (when given) resolves the pack's CURRENT accepted membership.
 * - `sourceIds` (when given) is filtered to accepted sources owned by this
 *   newsroom; anything missing, proposed, rejected, or unavailable is dropped
 *   rather than silently fetched.
 * - Throws when nothing acceptable remains, so the caller can refuse the scan
 *   with guidance instead of running an empty one.
 */
export async function resolveCustomScanSnapshot(input: {
  newsroomId: number;
  sourceIds?: number[];
  packId?: number;
}): Promise<CustomScanSnapshot> {
  const sql = await getSql();
  let candidateIds: number[] = [];
  let packName: string | undefined;
  let packId: number | undefined;

  if (input.packId) {
    const [pack] = await sql<{ id: number; name: string }>`
      select id, name from scan_source_packs
      where id = ${input.packId} and newsroom_id = ${input.newsroomId} limit 1
    `;
    if (!pack) throw new Error("That saved pack no longer exists.");
    const members = await sql<{ source_id: number }>`
      select source_id from scan_source_pack_members
      where pack_id = ${pack.id} and newsroom_id = ${input.newsroomId}
    `;
    candidateIds = members.map((m) => m.source_id);
    packName = pack.name;
    packId = pack.id;
  } else if (input.sourceIds) {
    candidateIds = [...new Set(input.sourceIds.filter(Number.isInteger))];
  }

  if (!candidateIds.length) {
    throw new Error("No sources were selected.");
  }

  const accepted = await sql<{ id: number }>`
    select id from sources
    where newsroom_id = ${input.newsroomId} and status = 'accepted'
      and id = any(${candidateIds}::int[])
  `;
  const acceptedIds = accepted.map((r) => r.id);
  if (!acceptedIds.length) {
    throw new Error("None of the selected sources are still accepted.");
  }
  const snapshot: CustomScanSnapshot = { kind: "custom", sourceIds: acceptedIds };
  if (packId && packName) {
    snapshot.packId = packId;
    snapshot.packName = packName;
  }
  return snapshot;
}

/** List this newsroom's saved packs with their current accepted membership. */
export async function listScanSourcePacks(newsroomId: number): Promise<ScanSourcePack[]> {
  const sql = await getSql();
  const packs = await sql<{ id: number; name: string }>`
    select id, name from scan_source_packs where newsroom_id = ${newsroomId} order by name asc
  `;
  const out: ScanSourcePack[] = [];
  for (const pack of packs) {
    const [counts] = await sql<{ accepted: number; total: number }>`
      select
        count(*) filter (where s.status = 'accepted')::int as accepted,
        count(*)::int as total
      from scan_source_pack_members m
      left join sources s on s.id = m.source_id and s.newsroom_id = m.newsroom_id
      where m.pack_id = ${pack.id} and m.newsroom_id = ${newsroomId}
    `;
    out.push({
      id: pack.id,
      name: pack.name,
      sourceIds: (
        await sql<{ source_id: number }>`
          select m.source_id from scan_source_pack_members m
          join sources s on s.id = m.source_id and s.newsroom_id = m.newsroom_id and s.status = 'accepted'
          where m.pack_id = ${pack.id} and m.newsroom_id = ${newsroomId}
          order by m.source_id
        `
      ).map((r) => r.source_id),
      acceptedCount: counts?.accepted ?? 0,
    });
  }
  return out;
}

/** Create or update a named pack from an explicit accepted source set. */
export async function saveScanSourcePack(input: {
  newsroomId: number;
  userId: string;
  name: string;
  sourceIds: number[];
  packId?: number;
}): Promise<{ id: number }> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Give the pack a name.");
  const sql = await getSql();
  // Only accepted sources may be members -- a pack never contains a
  // non-accepted source, by construction.
  const accepted = await sql<{ id: number }>`
    select id from sources
    where newsroom_id = ${input.newsroomId} and status = 'accepted' and id = any(${input.sourceIds}::int[])
  `;
  const ids = accepted.map((r) => r.id);
  if (!ids.length) throw new Error("A pack needs at least one accepted source.");

  let packId = input.packId;
  if (packId) {
    const updated = await sql<{ id: number }>`
      update scan_source_packs set name = ${name}, updated_at = now()
      where id = ${packId} and newsroom_id = ${input.newsroomId} returning id
    `;
    if (!updated[0]) throw new Error("That pack no longer exists.");
  } else {
    const inserted = await sql<{ id: number }>`
      insert into scan_source_packs (user_id, newsroom_id, name)
      values (${input.userId}, ${input.newsroomId}, ${name})
      on conflict (newsroom_id, name) do update set updated_at = now()
      returning id
    `;
    packId = inserted[0]!.id;
  }
  await sql`delete from scan_source_pack_members where pack_id = ${packId} and newsroom_id = ${input.newsroomId}`;
  for (const id of ids) {
    await sql`
      insert into scan_source_pack_members (pack_id, source_id, newsroom_id)
      values (${packId}, ${id}, ${input.newsroomId})
      on conflict do nothing
    `;
  }
  return { id: packId! };
}

/** Rename a pack without touching its membership. */
export async function renameScanSourcePack(input: {
  newsroomId: number;
  packId: number;
  name: string;
}): Promise<void> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Give the pack a name.");
  const sql = await getSql();
  const updated = await sql`
    update scan_source_packs set name = ${name}, updated_at = now()
    where id = ${input.packId} and newsroom_id = ${input.newsroomId} returning id
  `;
  if (!updated.length) throw new Error("That pack no longer exists.");
}

/** Delete a pack. Members cascade; accepted sources are untouched. */
export async function deleteScanSourcePack(input: {
  newsroomId: number;
  packId: number;
}): Promise<void> {
  const sql = await getSql();
  await sql`delete from scan_source_packs where id = ${input.packId} and newsroom_id = ${input.newsroomId}`;
}