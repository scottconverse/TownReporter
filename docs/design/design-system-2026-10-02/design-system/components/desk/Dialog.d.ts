import * as React from 'react';
/** Modal for every desk sub-view. Escape and backdrop click call onClose. In production use Radix Dialog (focus trap, scroll lock, focus return) with this styling. Footer: note · Cancel · optional alt · primary. */
export interface DialogProps {
  open: boolean; title: string; subtitle?: string; children?: React.ReactNode; footNote?: React.ReactNode;
  primaryLabel: string; onPrimary?: () => void; altLabel?: string; onAlt?: () => void; onClose?: () => void;
}
export function Dialog(props: DialogProps): JSX.Element | null;
export interface ChoiceCardProps { label: string; note?: string; selected?: boolean; onSelect?: () => void }
export function ChoiceCard(props: ChoiceCardProps): JSX.Element;
