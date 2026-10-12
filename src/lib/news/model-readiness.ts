export type ModelReadiness = "Ready" | "Sign in needed" | "Turned off" | "Not installed" | "Last test failed" | "Warning";

export type ReadinessFacts = {
  status?: {
    disabledByOperator: boolean;
    installed: boolean;
    signedIn: boolean;
    lastTest: { ok: boolean; detail?: string } | null;
    detail?: string;
  };
  connection?: {
    enabled: boolean;
    hasApiKey: boolean;
    modelId: string | null;
    lastTest?: { ok: boolean } | null;
  };
  available?: boolean;
  reason?: string;
};

/** Name only a state the connection read actually established. */
export function modelReadiness({ status, connection, available, reason }: ReadinessFacts): ModelReadiness | null {
  if (reason) return "Warning";
  if (status) {
    if (status.disabledByOperator) return "Turned off";
    if (!status.installed) return "Not installed";
    if (!status.signedIn) return "Sign in needed";
    if (status.lastTest?.ok === false) return "Last test failed";
    return "Ready";
  }
  if (connection) {
    if (!connection.enabled) return "Turned off";
    if (connection.lastTest?.ok === false) return "Last test failed";
    return connection.hasApiKey && connection.modelId ? "Ready" : null;
  }
  return available === true ? "Ready" : null;
}

export function modelReadinessOption(label: string, facts: ReadinessFacts): string {
  const readiness = modelReadiness(facts);
  return readiness ? `${label} · ${readiness}${facts.reason ? ` — ${facts.reason}` : ""}` : label;
}
