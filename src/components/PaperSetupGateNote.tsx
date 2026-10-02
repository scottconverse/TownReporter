import { Link } from "@tanstack/react-router";
import type { PaperSetupGate } from "./paper-setup-gate";

/**
 * The sentence beside a gated control, with the way out when there is one.
 *
 * Not set up → the sentence and a link to Paper setup. Could not check →
 * the sentence alone (there is nothing to press but Reload). Ready/checking →
 * nothing (the checking sentence is drawn by the hook's caller as plain text,
 * since it resolves by itself and needs no link).
 */
export function PaperSetupGateNote({ gate }: { gate: PaperSetupGate }) {
  if (gate.state === "ready") return null;
  return (
    <p className="mt-1 max-w-prose text-xs text-muted" data-paper-setup-gate={gate.state}>
      {gate.reason}
      {gate.state === "needs-setup" ? (
        <>
          {" "}
          <Link to="/desk/setup" className="underline">
            Open Paper setup
          </Link>
        </>
      ) : null}
    </p>
  );
}
