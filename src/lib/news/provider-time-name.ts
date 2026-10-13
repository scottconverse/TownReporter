/*
  FB17 (Oct 11 walk): two time rows were both "Local model" -- the model you
  pick by name, and the Local model step in Automatic's order -- so a time
  limit could not be told apart. The registry labels stay; only the time panel
  names which is which.
*/
export function timeRowName(row: { providerId: string; label: string }): string {
  if (row.providerId === "qwen-local") return `${row.label} (Automatic's step)`;
  if (row.providerId === "local-model") return `${row.label} (when you choose it)`;
  return row.label;
}
