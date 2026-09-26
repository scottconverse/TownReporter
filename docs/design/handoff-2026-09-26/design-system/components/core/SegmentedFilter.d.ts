/** Filter row with counts in labels, e.g. "Open · 12". */
export interface SegmentedFilterProps {
  options: { value: string; label: string }[];
  value: string;
  onChange?: (value: string) => void;
}
export function SegmentedFilter(props: SegmentedFilterProps): JSX.Element;
