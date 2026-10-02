/** Geography switch. Order is fixed: Longmont · Nearby · Boulder County · Colorado. */
export interface GeoPillsProps { active?: string; places?: string[]; hrefFor?: (place: string) => string }
export function GeoPills(props: GeoPillsProps): JSX.Element;
