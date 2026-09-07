/** Installation capability policy, shared by controls and server enforcement. */
export function unavailableOpsReason(id: string, managed: boolean, legacy: boolean): string | null {
  if (managed && (id === "restart-tunnel" || id === "rotate-logs"))
    return "This local install does not own machine-wide tunnel or log tasks.";
  if (
    !managed &&
    !legacy &&
    ["restart-app", "watchdog", "restart-tunnel", "rotate-logs"].includes(id)
  )
    return "No owned launcher is configured. Use this installation's Start/Stop scripts. Legacy host operators must explicitly set TOWNREPORTER_LEGACY_OPS=1.";
  return null;
}
