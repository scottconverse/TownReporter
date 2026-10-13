export type DeskWarning = { key: string; sentence: string };

export function deskWarning(value: unknown): DeskWarning | null {
  if (typeof value !== 'object' || value === null) return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.ok !== false) return null;
  if (typeof envelope.error !== 'string') return null;
  const warning = envelope.warning;
  if (typeof warning !== 'object' || warning === null) return null;
  const candidate = warning as Record<string, unknown>;
  if (typeof candidate.key !== 'string' || candidate.key.length === 0) return null;
  if (typeof candidate.sentence !== 'string' || candidate.sentence.length === 0) return null;
  return { key: candidate.key, sentence: candidate.sentence };
}

export function withDeskOverride<T>(variables: T, keys: readonly string[]): T {
  if (typeof variables !== 'object' || variables === null || Array.isArray(variables)) {
    return variables;
  }
  const source = variables as Record<string, unknown>;
  const existing = source.override;
  const merged: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(existing)) {
    for (const entry of existing) {
      if (typeof entry !== 'string') continue;
      if (seen.has(entry)) continue;
      seen.add(entry);
      merged.push(entry);
    }
  }
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(key);
  }
  return { ...source, override: merged } as T;
}

export type BulkDeskWarning = { id: number; key: string; sentence: string };

export function bulkDeskWarnings(
  ids: readonly number[],
  settled: readonly PromiseSettledResult<unknown>[],
): BulkDeskWarning[] {
  const output: BulkDeskWarning[] = [];
  const count = Math.min(ids.length, settled.length);
  for (let index = 0; index < count; index += 1) {
    const result = settled[index];
    if (result.status !== 'fulfilled') continue;
    const warning = deskWarning(result.value);
    if (warning === null) continue;
    output.push({ id: ids[index], key: warning.key, sentence: warning.sentence });
  }
  return output;
}

export function bulkWarningSentence(warnings: readonly BulkDeskWarning[]): string {
  const total = warnings.length;
  let draft = 0;
  let published = 0;
  let other = 0;
  for (const warning of warnings) {
    const key = warning.key.toLowerCase();
    if (key.includes('draft')) {
      draft += 1;
    } else if (key.includes('publish')) {
      published += 1;
    } else {
      other += 1;
    }
  }
  if (draft > 0 && published === 0 && other === 0) {
    return `${total} of the selected leads have a written draft.`;
  }
  if (published > 0 && draft === 0 && other === 0) {
    return `${total} of the selected leads have a published story.`;
  }
  return `${total} of the selected leads have a written draft or a published story.`;
}

/** Re-run only warned leads; retain approved keys and the original batch payload. */
export function bulkDeskRetry<T extends { ids: number[]; overrideById?: Record<number, string[]> }>(
  press: T, warnings: readonly BulkDeskWarning[],
): T {
  return { ...press, ids: warnings.map(w => w.id), overrideById: {
    ...press.overrideById,
    ...Object.fromEntries(warnings.map(w => [w.id, [...new Set([...(press.overrideById?.[w.id] ?? []), w.key])]])),
  } };
}
