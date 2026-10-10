import { audit } from "./ops.ts";

export type OverrideWarning = { ok: false; warning: { key: string; sentence: string } };

export function isOverrideWarning(value: unknown): value is OverrideWarning {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ok?: unknown; warning?: unknown };
  if (candidate.ok !== false) return false;
  const warning = candidate.warning as { key?: unknown; sentence?: unknown } | undefined;
  return Boolean(
    warning && typeof warning.key === "string" && typeof warning.sentence === "string",
  );
}

export function checkOverride(
  input: { override?: string[] },
  key: string,
  sentence: string,
): OverrideWarning | null {
  if (input.override?.includes(key)) return null;
  return { ok: false, warning: { key, sentence } };
}

export async function auditOverrides(
  context: { userId: string; newsroomId: number },
  keys: string[],
  target: { kind: string; id: number },
): Promise<void> {
  for (const key of [...new Set(keys)]) {
    await audit(
      context.userId,
      "override",
      JSON.stringify({ key, target }),
      context.newsroomId,
      target,
    );
  }
}
