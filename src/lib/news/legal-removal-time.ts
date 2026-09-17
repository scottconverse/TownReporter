export function removalExpiry(date: Date): Date {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid retention date.");
  const expiry = new Date(date);
  const month = expiry.getUTCMonth();
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  if (expiry.getUTCMonth() !== month) expiry.setUTCDate(0);
  return expiry;
}
