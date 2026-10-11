export function draftItemLabel(
  row: { id?: unknown; lead_id?: unknown } | null | undefined,
  index: number,
): string {
  if (!row) return `Draft ${index + 1}`;
  const id = row.id ?? index + 1;
  return row.lead_id == null ? `Draft ${id}` : `Draft ${id} (lead ${row.lead_id})`;
}
