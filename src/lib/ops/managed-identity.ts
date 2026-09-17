/** PowerShell 5.1 config is UTF-8 with BOM. Invalid or moved installs are not owners. */
export function ownsManagedInstall(
  text: string,
  root: string,
  instanceId: string | undefined,
): boolean {
  try {
    const config = JSON.parse(text.replace(/^\uFEFF/, ""));
    return Boolean(
      instanceId &&
      /^[a-f0-9]{32}$/.test(instanceId) &&
      config.AppRoot === root &&
      config.InstanceId === instanceId,
    );
  } catch {
    return false;
  }
}
