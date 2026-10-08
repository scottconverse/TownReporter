export function confirmBeforeKillingDuplicate(
  confirm: (message: string) => boolean,
  message: string,
  kill: () => void,
): boolean {
  if (!confirm(message)) return false;
  kill();
  return true;
}
