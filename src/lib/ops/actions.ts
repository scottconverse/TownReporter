/**
 * The fixed list of things the ops dashboard is allowed to do.
 *
 * This is the security boundary for the whole feature. A dashboard that can run
 * the machine is a dashboard that can run the machine for whoever gets past the
 * login, so nothing here takes a free-text parameter and nothing here reaches a
 * shell with anything a caller supplied. A request names one of these ids or it
 * is refused; the id maps to a script path chosen here, in code.
 *
 * Kept separate from the server module so the list can be tested without
 * pulling in `node:child_process`.
 */
export type OpsActionId =
  | "watchdog"
  | "restart-app"
  | "restart-tunnel"
  | "rotate-logs"
  | "refresh-fonts"
  | "migrate";

export type OpsAction = {
  id: OpsActionId;
  label: string;
  /** What the operator is about to do, in their words, before they do it. */
  detail: string;
  /** True when the paper stops answering for a few seconds. */
  interrupts: boolean;
  /** Roughly how long before it is worth looking again. */
  expectSeconds: number;
};

export const OPS_ACTIONS: readonly OpsAction[] = [
  {
    id: "watchdog",
    label: "Run health check now",
    detail:
      "Runs the same check the machine runs every five minutes: Postgres, the app, the tunnel, and whether the public address answers. Repairs anything that is down.",
    interrupts: false,
    expectSeconds: 20,
  },
  {
    id: "restart-tunnel",
    label: "Restart the tunnel",
    detail:
      "Stops cloudflared and starts it again. The paper is unreachable from the internet for a few seconds; it keeps serving on this machine throughout.",
    interrupts: true,
    expectSeconds: 25,
  },
  {
    id: "restart-app",
    label: "Restart the paper",
    detail:
      "Stops and restarts the web server. Everything in progress on the desk is lost. The public site is down for a few seconds.",
    interrupts: true,
    expectSeconds: 25,
  },
  {
    id: "migrate",
    label: "Apply database migrations",
    detail:
      "Brings the database schema up to date. Does nothing when it already is.",
    interrupts: false,
    expectSeconds: 20,
  },
  {
    id: "refresh-fonts",
    label: "Re-download the fonts",
    detail:
      "Fetches the paper's webfonts from Google once and writes them into this server, so readers never request them from Google. Needs a rebuild and a restart before readers see any change.",
    interrupts: false,
    expectSeconds: 60,
  },
  {
    id: "rotate-logs",
    label: "Rotate the logs",
    detail: "Moves the current log files aside and starts fresh ones.",
    interrupts: false,
    expectSeconds: 10,
  },
] as const;

const BY_ID = new Map(OPS_ACTIONS.map((a) => [a.id, a]));

export function findOpsAction(id: string): OpsAction | null {
  return BY_ID.get(id as OpsActionId) ?? null;
}

/**
 * Is this string one of the allowed ids?
 *
 * Written as a lookup against the list rather than a regex or a prefix test:
 * the only ids that exist are the ones declared above, and a new one has to be
 * added here deliberately.
 */
export function isOpsActionId(id: unknown): id is OpsActionId {
  return typeof id === "string" && BY_ID.has(id as OpsActionId);
}
