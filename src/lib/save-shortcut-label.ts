export function saveShortcutLabel(platform: string): string {
  return /Mac/i.test(platform) ? "⌘S" : "Ctrl+S";
}
