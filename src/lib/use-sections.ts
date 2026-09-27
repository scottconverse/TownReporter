import { useQuery } from "@tanstack/react-query";
import { editorSections, publicSections } from "./news/sections";
import { isMiscTopic } from "./news/section-types";
/*
  The seam between the two audiences for one table.

  `newsroom_sections` is the same rows for the desk and for the paper, and the
  reader's copy of it is narrower on purpose (unit BX): a replacement row is
  not a section a reader can browse, and neither is the "misc" catch-all, whose
  name reads as a filing instruction rather than as news. Both filters live
  here so every reader-side list -- the nav row's links, the "More sections"
  menu, the archive's Section select, a topic chip -- inherits them together.
  The desk's read keeps every row: an editor looking at the counts needs to see
  every bucket a story can be filed under.
*/
export function useEditorSections() {
  const query = useQuery({ queryKey: ["editor-sections"], queryFn: () => editorSections() });
  return { ...query, sections: query.data?.sections.filter((s) => !s.replacementKey) ?? [] };
}
export function usePublicSections() {
  const query = useQuery({ queryKey: ["public-sections"], queryFn: () => publicSections() });
  return {
    ...query,
    sections: query.data?.filter((s) => !s.replacementKey && !isMiscTopic(s.key)) ?? [],
  };
}
