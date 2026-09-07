import type { OpsAction } from "./actions";

export function installAction(action: OpsAction, managed: boolean): OpsAction {
  if (managed && action.id === "watchdog")
    return {
      ...action,
      detail:
        "Runs a read-only check of this installation's process ownership, database, compiled build and local newspaper response. It does not start or repair services.",
      expectSeconds: 30,
    };
  if (managed && action.id === "restart-app")
    return {
      ...action,
      detail:
        "Stops this installation's web server and its writing/browser processes, then starts it again. Its database and saved work are retained. Let active writing finish first.",
      expectSeconds: 30,
    };
  return action;
}
export function siteProbeDescription(site: string): { label: string; note: string } {
  let local = false;
  try {
    local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(site).hostname);
  } catch {
    /* Invalid addresses are reported by the fetch probe. */
  }
  return local
    ? {
        label: "Local site",
        note: "Checked on this computer. This does not verify public access or a tunnel.",
      }
    : {
        label: "Public site",
        note: "Checked from this computer. A response does not establish that every reader can reach the site or which network route they use.",
      };
}
export function installLogFiles(managed: boolean): { name: string; file: string }[] {
  return managed
    ? [
        { name: "Paper (errors)", file: "app.err.log" },
        { name: "Paper (output)", file: "app.out.log" },
        { name: "Readiness (errors)", file: "readiness.err.log" },
        { name: "Restart (errors)", file: "restart.err.log" },
      ]
    : [
        { name: "Watchdog", file: "watchdog.log" },
        { name: "Paper (errors)", file: "app.err.log" },
        { name: "Paper (output)", file: "app.out.log" },
        { name: "Tunnel", file: "cloudflared.err.log" },
      ];
}
