/*
  DHF-9: the primary publish press and the "publish anyway" press sit in the
  same area. With no section chosen, the primary press must not say the
  opposite of what the second press does, so both words come from here.
*/
export function publishPrimaryLabel(input: { sectionReady: boolean; sectionName: string }): string {
  return input.sectionReady
    ? `Publish in ${input.sectionName}`
    : `No section chosen. Pick one, or publish in ${input.sectionName} anyway.`;
}
