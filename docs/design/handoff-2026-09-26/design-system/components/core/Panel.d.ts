import * as React from 'react';
/** Desk panel: panel fill + 1px rule. emphasis = 2px yellow (the thing to act on now). stateColor = 4px left edge. dark = Dark Desk block. */
export interface PanelProps {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  emphasis?: boolean;
  stateColor?: string;
  dark?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Panel(props: PanelProps): JSX.Element;
