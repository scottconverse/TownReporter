import { createContext, createElement, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { editorSections, publicSections } from "./news/sections.ts";
import { isMiscTopic } from "./news/section-types.ts";

/** The reader-facing slice of a section row, as the route loader returns it. */
export type PublicSection = {
  key: string;
  name: string;
  visible: boolean;
  replacementKey: string | null;
};

const PublicSectionsInitialData = createContext<PublicSection[] | undefined>(undefined);

/**
 * Seed the reader's section query from data already read by the route loader.
 *
 * The masthead, kickers and rows all call `usePublicSections()`. Without a
 * seed, each of those calls is pending during server rendering, so the first
 * paint falls back to stored topic keys such as `arts-culture`. One provider
 * above the paper gives every consumer the same server-read labels.
 */
export function PublicSectionsSeed({
  sections,
  children,
}: {
  sections: PublicSection[];
  children: ReactNode;
}) {
  return createElement(PublicSectionsInitialData.Provider, { value: sections }, children);
}
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
  const initialData = useContext(PublicSectionsInitialData);
  const query = useQuery({
    queryKey: ["public-sections"],
    queryFn: () => publicSections(),
    initialData,
  });
  return {
    ...query,
    sections: query.data?.filter((s) => !s.replacementKey && !isMiscTopic(s.key)) ?? [],
  };
}
