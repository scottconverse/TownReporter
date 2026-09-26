import * as React from 'react';
/**
 * The one button family. Primary = the next step (yellow, max 1–2 per view). Danger names the destructive result.
 * @startingPoint section="Core" subtitle="Primary, secondary, quiet, danger, gated" viewport="700x120"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = yellow next step · secondary = 2px ink · quiet = 1px rule · danger = red outline · gated = dashed, disabled publish */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'gated';
  /** lg = 48px header actions */
  size?: 'md' | 'lg';
  /** Keyboard shortcut shown inside the button, e.g. "S", "⌘S" */
  keyHint?: string;
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;
