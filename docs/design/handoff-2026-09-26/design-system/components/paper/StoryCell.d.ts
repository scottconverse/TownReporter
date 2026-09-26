/** Front-page story cell; StoryGrid draws the ruled 1px gaps. */
export interface StoryCellProps { section: string; title: string; date: string; read: string; href?: string }
export function StoryCell(props: StoryCellProps): JSX.Element;
export interface StoryGridProps { children?: any; columns?: number }
export function StoryGrid(props: StoryGridProps): JSX.Element;
