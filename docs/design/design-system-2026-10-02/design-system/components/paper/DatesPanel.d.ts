/**
 * "This week" (front page) and "Dates in this story" (article). Block panel with yellow day labels.
 * @startingPoint section="Paper" subtitle="This week / Dates in this story" viewport="420x460"
 */
export interface DatesPanelProps {
  title?: string;
  items: { dow: string; day: string; what: string; note?: string }[];
  footLink?: { label: string; href: string };
}
export function DatesPanel(props: DatesPanelProps): JSX.Element;
