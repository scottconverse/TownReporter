/**
 * One lead in the queue. Hold and Kill should open the reason dialog (optional reason + “no reason” button); Undo stays on the row.
 * @startingPoint section="Desk" subtitle="Score, chips, why, evidence, actions" viewport="700x170"
 */
export interface LeadRowProps {
  lead: { score: number; title: string; why: string; meta: string; opened: number; failed?: number; chips?: { kind: 'new' | 'printed' | 'neutral' | 'warn'; label: string }[] };
  selected?: boolean;
  status?: 'open' | 'held' | 'killed';
  onStart?: () => void; onHold?: () => void; onKill?: () => void; onUndo?: () => void; onSelect?: () => void;
}
export function LeadRow(props: LeadRowProps): JSX.Element;
