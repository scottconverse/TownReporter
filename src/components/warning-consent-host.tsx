import { useEffect, useState } from "react";
import { ActionButton } from "./action-button";
import { Dialog } from "./dialog";
import { warningPressLabel } from "./editor-warning";
import type { WarningConsentChannel } from "./editor-warning-consent";

export function WarningConsentHost({ channel }: { channel: WarningConsentChannel }) {
  const [state, setState] = useState(() => channel.get());
  useEffect(() => {
    const unsubscribe = channel.subscribe(() => setState(channel.get()));
    return () => { unsubscribe(); channel.cancelAll(); };
  }, [channel]);
  if (!state) return null;
  return <Dialog open role="alertdialog" title="Before you continue" ariaLabel={state.request.action} primaryLabel={state.request.action} primaryAction={<ActionButton phase="idle" tone="primary" onAct={() => channel.resolve(true)}>{warningPressLabel(state.request.action, state.request.kind, state.request.model)}</ActionButton>} onPrimary={() => channel.resolve(true)} onClose={() => channel.resolve(false)}>
    <p role="alert">{state.request.sentence}</p>
  </Dialog>;
}
