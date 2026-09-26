/**
 * Desk side nav with counts and the live Running box.
 * @startingPoint section="Desk" subtitle="Side nav with Running box" viewport="260x760"
 */
export interface DeskNavProps {
  items: { label: string; count?: string | number }[];
  active: string;
  onNavigate?: (label: string) => void;
  running?: { title: string; line: string }[];
  themeLabel?: string; onToggleTheme?: () => void;
}
export function DeskNav(props: DeskNavProps): JSX.Element;
