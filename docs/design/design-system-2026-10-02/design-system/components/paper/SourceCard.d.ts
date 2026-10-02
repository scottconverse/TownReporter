/** "How we reported this" record card. Place in a 2-col grid with 1px gaps over var(--grid). */
export interface SourceCardProps { role: string; title: string; host: string; captured?: string; currentHref: string; capturedHref?: string; compareHref?: string }
export function SourceCard(props: SourceCardProps): JSX.Element;
